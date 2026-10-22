import Application from '../models/admin/applicationModel.js';
import Customer from '../models/Customer.js';
import KycReview from '../models/admin/kycReviewModel.js';
import { isDbConnected } from '../config/db.js';
import { cleanNic, parseNic, toNewFormat } from '../utils/sriLankaNic.js';
import { recordAudit } from './auditService.js';
import { identityChecks } from './kycIdentityChecks.js';

// ─────────────────────────────────────────────────────────────────────────────
// Automated KYC review
//
// Decides each case from facts the system already holds, and nothing else:
//   approved – every check passed (identity can be established with certainty)
//   rejected – a definite contradiction (the NIC conflicts with the identity
//              registered for the customer)
//   flagged  – anything missing, ambiguous or suspicious → a person decides
//
// Identity photos follow the customer flow (new customer: NIC front + back +
// live selfie; returning customer with NIC photos on file: a new live selfie
// only) — see kycIdentityChecks.js. The selfie is compared with the NIC photo
// by local face matching on this server; no ID image is sent anywhere.
// ─────────────────────────────────────────────────────────────────────────────

export const SYSTEM_ACTOR_NAME = 'Automated KYC';

const NAME_FIELDS = ['nameFull', 'fullName', 'contactName', 'customerName', 'legalOwner', 'currentCustomerName', 'applicantName'];
const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'rev', 'ven', 'hon', 'sir', 'madam', 'master', 'mst']);

// Statuses each kind of automated run is allowed to change. 'pending payment'
// and 'confirmed' belong to the payment / appointment flow and are never touched.
const AUTO_CAN_CHANGE = ['pending'];
const RERUN_CAN_CHANGE = ['pending', 'flagged', 'approved', 'rejected'];

const pick = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
};

const last9Of = (phone) => String(phone || '').replace(/\D/g, '').slice(-9);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Name comparison ──────────────────────────────────────────────────────────

export function nameTokens(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t && !TITLES.has(t));
}

function editDistanceAtMost1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const tokensAgree = (a, b) => {
  if (a === b) return true;
  if (a.length === 1 && b.startsWith(a)) return true; // initial
  if (b.length === 1 && a.startsWith(b)) return true;
  return Math.min(a.length, b.length) >= 4 && editDistanceAtMost1(a, b);
};

/** → { agree: boolean, partial: boolean } */
export function compareNames(x, y) {
  const a = nameTokens(x);
  const b = nameTokens(y);
  if (!a.length || !b.length) return { agree: false, partial: false, missing: true };

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const used = new Set();
  let matched = 0;
  short.forEach((t) => {
    const idx = long.findIndex((u, i) => !used.has(i) && tokensAgree(t, u));
    if (idx >= 0) { used.add(idx); matched += 1; }
  });

  const agree = matched === short.length && (matched >= 2 || (short.length === 1 && long.length === 1));
  return { agree, partial: !agree && matched > 0, missing: false };
}

// ── Checks ───────────────────────────────────────────────────────────────────

const check = (key, label, result, detail) => ({ key, label, result, detail });

function nicFormatCheck(rawNic, parsed) {
  if (!rawNic || /^NIC-\d+$/i.test(rawNic)) {
    return check('nic_format', 'NIC number', 'unsure', 'No NIC number was supplied with this request.');
  }
  if (!parsed) {
    return check('nic_format', 'NIC number', 'unsure',
      `"${rawNic}" is not a valid Sri Lankan NIC number — it may be a passport or business registration number, or a typing error.`);
  }
  return check('nic_format', 'NIC number', 'pass',
    `${parsed.nic} is a valid ${/^\d{12}$/.test(parsed.nic) ? 'new (12-digit)' : 'old'} NIC format.`);
}

function profileConsistencyChecks(parsed, { profileDob, profileGender, sourceLabel }) {
  const out = [];
  if (!parsed) return out;

  const problems = [];
  const agreed = [];

  if (parsed.dob && profileDob) {
    if (String(profileDob).slice(0, 10) === parsed.dob) agreed.push('birth date');
    else problems.push(`${sourceLabel} birth date ${String(profileDob).slice(0, 10)} but the NIC encodes ${parsed.dob}`);
  }
  if (profileGender) {
    if (String(profileGender).toLowerCase() === parsed.gender.toLowerCase()) agreed.push('gender');
    else problems.push(`${sourceLabel} gender ${profileGender} but the NIC encodes ${parsed.gender}`);
  }

  if (problems.length) {
    out.push(check('dob_gender', 'Birth date & gender vs NIC', 'unsure', `${problems.join('; ')}.`));
  } else if (agreed.length) {
    out.push(check('dob_gender', 'Birth date & gender vs NIC', 'pass',
      `The ${agreed.join(' and ')} on the ${sourceLabel.replace(/ lists$/, '')} agree${agreed.length === 1 ? 's' : ''} with what the NIC number encodes.`));
  } else {
    out.push(check('dob_gender', 'Birth date & gender vs NIC', 'unsure',
      'No birth date or gender is on file to compare with the NIC number.'));
  }

  if (parsed.age !== null) {
    out.push(parsed.age < 18
      ? check('age', 'Applicant age', 'unsure', `The NIC number indicates the holder is ${parsed.age} years old (under 18).`)
      : check('age', 'Applicant age', 'pass', `The holder is ${parsed.age} years old.`));
  }
  return out;
}

/** pass/fail/unsure → approved / rejected / flagged. 'manual' never blocks. */
export function decide(checks) {
  if (checks.some((c) => c.result === 'fail')) return 'rejected';
  if (checks.some((c) => c.result === 'unsure')) return 'flagged';
  return 'approved';
}

export function buildRemark(decision, checks) {
  if (decision === 'approved') {
    const labels = checks.filter((c) => c.result === 'pass').map((c) => c.label.toLowerCase());
    return `Auto-approved: every automated check passed (${labels.join(', ')}).`;
  }
  if (decision === 'rejected') {
    return `Auto-rejected: ${checks.filter((c) => c.result === 'fail').map((c) => c.detail).join(' ')}`;
  }
  return `Flagged for manual review: ${checks.filter((c) => c.result === 'unsure').map((c) => c.detail.replace(/\.$/, '')).join('; ')}.`;
}

// ── Evaluation ───────────────────────────────────────────────────────────────

// Other requests made with this NIC or phone number.
async function relatedApplications(rawNic, phone, excludeId) {
  const last9 = last9Of(phone);
  const nicForms = [...new Set([rawNic, toNewFormat(rawNic)].filter(Boolean))];
  const or = [
    ...(nicForms.length ? [{ nic: { $in: nicForms } }] : []),
    ...(last9.length === 9 ? [{ phone: new RegExp(`${escapeRegex(last9)}$`) }] : []),
  ];
  if (!or.length) return [];
  return Application.find({ ...(excludeId ? { _id: { $ne: excludeId } } : {}), $or: or })
    .select('nic phone status referenceNumber createdAt formData documents')
    .sort({ createdAt: -1 })
    .limit(40)
    .lean();
}

async function findAccounts(rawNic, phone) {
  const cleaned = cleanNic(rawNic);
  const nicForms = [...new Set([rawNic, cleaned, toNewFormat(cleaned)].filter(Boolean))];
  const last9 = last9Of(phone);

  const [byNic, byPhone] = await Promise.all([
    nicForms.length ? Customer.findOne({ NIC: { $in: nicForms } }).lean() : null,
    last9.length === 9 ? Customer.findOne({ phone: new RegExp(`${last9}$`) }).lean() : null,
  ]);
  return { byNic, byPhone };
}

export async function evaluateApplication(app) {
  const fd = app.formData || {};
  const rawNic = cleanNic(app.nic);
  const parsed = parseNic(rawNic);
  const appName = pick(fd, NAME_FIELDS);
  const { byNic, byPhone } = await findAccounts(rawNic, app.phone);
  const account = byNic || byPhone || null;

  const checks = [nicFormatCheck(rawNic, parsed)];

  // Does the NIC match the identity registered for this customer?
  if (!account) {
    checks.push(check('registered_identity', 'Matches registered identity', 'unsure',
      'No registered customer account was found for this NIC or phone number, so there is nothing to verify the details against.'));
  } else if (byNic && byPhone && String(byNic._id) !== String(byPhone._id)) {
    // Both identities are real, so this is ambiguous (e.g. a family phone) — a person decides.
    checks.push(check('registered_identity', 'Matches registered identity', 'unsure',
      `NIC ${rawNic} is registered to a different customer than the one who owns phone ${app.phone}.`));
  } else if (!byNic && byPhone) {
    const registered = toNewFormat(byPhone.NIC) || cleanNic(byPhone.NIC);
    const submitted = toNewFormat(rawNic) || rawNic;
    if (registered && submitted && registered !== submitted && parsed && parseNic(byPhone.NIC)) {
      checks.push(check('registered_identity', 'Matches registered identity', 'fail',
        `The NIC on this request (${rawNic}) does not match the NIC registered for phone ${app.phone} (${byPhone.NIC}).`));
    } else {
      checks.push(check('registered_identity', 'Matches registered identity', 'unsure',
        'The NIC could not be compared with the registered account.'));
    }
  } else {
    checks.push(check('registered_identity', 'Matches registered identity', 'pass',
      `NIC ${rawNic} matches the registered customer account.`));
  }

  if (account) {
    // Phone
    const phoneAgrees = last9Of(account.phone) === last9Of(app.phone) && last9Of(app.phone).length === 9;
    checks.push(phoneAgrees
      ? check('phone', 'Phone number', 'pass', 'The OTP-verified phone number is the one registered on the account.')
      : check('phone', 'Phone number', 'unsure',
        `Phone ${app.phone} differs from the number registered on the account (${account.phone}).`));

    // Name
    const names = compareNames(appName, account.name);
    if (names.missing) {
      checks.push(check('name', 'Name', 'unsure', 'No applicant name was supplied to compare with the registered name.'));
    } else if (names.agree) {
      checks.push(check('name', 'Name', 'pass', `"${appName}" agrees with the registered name "${account.name}".`));
    } else {
      checks.push(check('name', 'Name', 'unsure',
        `"${appName}" ${names.partial ? 'only partly matches' : 'does not match'} the registered name "${account.name}".`));
    }
  }

  // Profile vs NIC: use the account's recorded values, and the form's DOB if given.
  checks.push(...profileConsistencyChecks(parsed, {
    profileDob: fd.dob || account?.dob,
    profileGender: account?.gender,
    sourceLabel: fd.dob ? 'request lists' : 'registered profile lists',
  }));

  // Same NIC under a different name, or the same phone under a different NIC, elsewhere.
  const last9 = last9Of(app.phone);
  const others = await relatedApplications(rawNic, app.phone, app._id);

  const conflicts = [];
  others.forEach((o) => {
    const oName = pick(o.formData, NAME_FIELDS);
    if (o.nic === rawNic && appName && oName && !compareNames(appName, oName).agree) {
      conflicts.push(`this NIC was also used with the name "${oName}"`);
    }
    const oNic = toNewFormat(o.nic) || cleanNic(o.nic);
    const thisNic = toNewFormat(rawNic) || rawNic;
    if (o.nic !== rawNic && last9Of(o.phone) === last9 && oNic && thisNic && oNic !== thisNic && parseNic(o.nic)) {
      conflicts.push(`this phone number was also used with NIC ${o.nic}`);
    }
  });
  const uniqueConflicts = [...new Set(conflicts)];
  checks.push(uniqueConflicts.length
    ? check('duplicate_identity', 'No conflicting use elsewhere', 'unsure', `Possible identity reuse — ${uniqueConflicts.join('; ')}.`)
    : check('duplicate_identity', 'No conflicting use elsewhere', 'pass', 'This NIC and phone number are not used with any conflicting details on other requests.'));

  // NIC photos + live selfie, and the face match between them.
  const identity = await identityChecks({
    subjectKind: 'application',
    submittedAt: app.createdAt || new Date(),
    formDocs: { ...fd.documents, ...app.documents },
    account,
    rawNic,
    related: others,
  });
  checks.push(...identity.checks);

  const decision = decide(checks);
  return { decision, checks, remark: buildRemark(decision, checks), caseInfo: identity.caseInfo };
}

export async function evaluateAccount(customer) {
  const rawNic = cleanNic(customer.NIC);
  const parsed = parseNic(rawNic);
  const checks = [nicFormatCheck(rawNic, parsed)];

  checks.push(...profileConsistencyChecks(parsed, {
    profileDob: customer.dob,
    profileGender: customer.gender,
    sourceLabel: 'registration lists',
  }));

  const identity = await identityChecks({
    subjectKind: 'account',
    submittedAt: customer.identityDocuments?.capturedAt || customer.createdAt || new Date(),
    formDocs: null,
    account: customer,
    rawNic,
    related: await relatedApplications(rawNic, customer.phone, null),
  });
  checks.push(...identity.checks);

  const decision = decide(checks);
  return { decision, checks, remark: buildRemark(decision, checks), caseInfo: identity.caseInfo };
}

// ── Applying a decision ──────────────────────────────────────────────────────

// Automated decisions appear in the admin audit log as "Automated KYC", next to
// the manual ones. A logging failure must never undo a saved decision.
async function auditAutomatedDecision({ subjectType, target, from, decision, remark, kind, requestedBy }) {
  try {
    await recordAudit({
      actor: { name: SYSTEM_ACTOR_NAME, role: 'system' },
      action: 'STATUS_UPDATE',
      module: 'KYC',
      targetId: target,
      description: `Automated KYC changed status from ${from} to ${decision}`,
      metadata: {
        previousStatus: from,
        newStatus: decision,
        remark,
        automated: true,
        kind,
        subjectType,
        ...(requestedBy ? { requestedBy } : {}),
      },
    });
  } catch (err) {
    console.error('[kyc-auto] audit log failed:', err.message);
  }
}

async function recordReview({ subjectType, subjectId, evaluation, statusChange, kind, requestedBy }) {
  const now = new Date();
  const set = {
    autoDecision: evaluation.decision,
    autoCheckedAt: now,
    checks: evaluation.checks,
    caseInfo: evaluation.caseInfo || null,
  };
  const update = { $set: set };

  if (statusChange) {
    const remark = kind === 'rerun' && requestedBy
      ? `${evaluation.remark} (Re-check requested by ${requestedBy}.)`
      : evaluation.remark;
    Object.assign(set, { decidedBy: 'system', decidedByName: SYSTEM_ACTOR_NAME, decidedById: null, decidedAt: now });
    update.$push = {
      history: {
        at: now, actor: 'system', actorName: SYSTEM_ACTOR_NAME, actorId: null, kind,
        fromStatus: statusChange.from, toStatus: evaluation.decision, remark,
      },
    };
  }
  // else: checks are refreshed but the status is not ours to change, so no
  // decision is attributed to anyone.

  return KycReview.findOneAndUpdate({ subjectType, subjectId }, update, { upsert: true, returnDocument: 'after' });
}

/**
 * Runs the automated review for one case and, where permitted, applies it.
 * Returns { applied, decision, review } — `applied: false` means someone else
 * (another server, or an admin) got there first or the status is not ours to change.
 */
export async function reviewApplicationAuto(app, { kind = 'auto', requestedBy = null } = {}) {
  const evaluation = await evaluateApplication(app);
  const allowed = kind === 'rerun' ? RERUN_CAN_CHANGE : AUTO_CAN_CHANGE;

  if (!allowed.includes(app.status)) {
    const review = await recordReview({ subjectType: 'application', subjectId: app._id, evaluation, statusChange: null, kind });
    return { applied: false, decision: evaluation.decision, review };
  }

  const remark = kind === 'rerun' && requestedBy
    ? `${evaluation.remark} (Re-check requested by ${requestedBy}.)`
    : evaluation.remark;

  // The status in the filter makes this atomic across servers: only one wins.
  const updated = await Application.findOneAndUpdate(
    { _id: app._id, status: app.status },
    { $set: { status: evaluation.decision, notes: remark.slice(0, 2000), actionedBy: null, actionedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!updated) return { applied: false, decision: evaluation.decision, review: null };

  const review = await recordReview({
    subjectType: 'application', subjectId: app._id, evaluation, statusChange: { from: app.status }, kind, requestedBy,
  });
  await auditAutomatedDecision({
    subjectType: 'application', target: app.referenceNumber || app._id, from: app.status,
    decision: evaluation.decision, remark, kind, requestedBy,
  });
  return { applied: true, decision: evaluation.decision, review };
}

export async function reviewAccountAuto(customer, { kind = 'auto', requestedBy = null } = {}) {
  const evaluation = await evaluateAccount(customer);
  const current = customer.kycStatus || 'pending';
  const allowed = kind === 'rerun' ? RERUN_CAN_CHANGE : AUTO_CAN_CHANGE;

  if (!allowed.includes(current)) {
    const review = await recordReview({ subjectType: 'account', subjectId: customer._id, evaluation, statusChange: null, kind });
    return { applied: false, decision: evaluation.decision, review };
  }

  const remark = kind === 'rerun' && requestedBy
    ? `${evaluation.remark} (Re-check requested by ${requestedBy}.)`
    : evaluation.remark;

  const updated = await Customer.findOneAndUpdate(
    {
      _id: customer._id,
      ...(current === 'pending'
        ? { $or: [{ kycStatus: { $exists: false } }, { kycStatus: 'pending' }] }
        : { kycStatus: current }),
    },
    { $set: { kycStatus: evaluation.decision, kycNotes: remark.slice(0, 2000), kycActionedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!updated) return { applied: false, decision: evaluation.decision, review: null };

  const review = await recordReview({
    subjectType: 'account', subjectId: customer._id, evaluation, statusChange: { from: current }, kind, requestedBy,
  });
  await auditAutomatedDecision({
    subjectType: 'account', target: customer._id, from: current,
    decision: evaluation.decision, remark, kind, requestedBy,
  });
  return { applied: true, decision: evaluation.decision, review };
}

// ── Sweep + scheduler ────────────────────────────────────────────────────────

let sweeping = false;

/** Reviews every case that is still waiting and has never been checked. */
export async function runKycAutoReview({ limit = 25 } = {}) {
  const summary = { checked: 0, approved: 0, rejected: 0, flagged: 0, skipped: 0 };
  if (!isDbConnected() || sweeping) return summary;
  sweeping = true;

  try {
    const tally = (r) => {
      summary.checked += 1;
      if (r.applied) summary[r.decision] += 1;
      else summary.skipped += 1;
    };

    const reviewedApps = await KycReview.find({ subjectType: 'application' }).distinct('subjectId');
    const apps = await Application
      .find({ status: 'pending', _id: { $nin: reviewedApps } })
      .sort({ createdAt: 1 })
      .limit(limit);
    for (const app of apps) {
      try { tally(await reviewApplicationAuto(app)); } catch (err) {
        summary.skipped += 1;
        console.error(`[kyc-auto] ${app.referenceNumber} failed:`, err.message);
      }
    }

    // Registered customers with captured ID images and no application yet.
    const reviewedAccounts = await KycReview.find({ subjectType: 'account' }).distinct('subjectId');
    const appNics = new Set((await Application.distinct('nic')).map((n) => String(n).toUpperCase()));
    const customers = await Customer.find({
      'identityDocuments.nicFront': { $exists: true },
      _id: { $nin: reviewedAccounts },
      $or: [{ kycStatus: { $exists: false } }, { kycStatus: 'pending' }],
    }).sort({ 'identityDocuments.capturedAt': 1 }).limit(limit);

    for (const customer of customers.filter((c) => !appNics.has(String(c.NIC).toUpperCase()))) {
      try { tally(await reviewAccountAuto(customer)); } catch (err) {
        summary.skipped += 1;
        console.error(`[kyc-auto] account ${customer._id} failed:`, err.message);
      }
    }
  } finally {
    sweeping = false;
  }

  if (summary.approved + summary.rejected + summary.flagged > 0) {
    console.log(`[kyc-auto] reviewed ${summary.checked}: ${summary.approved} approved, ${summary.rejected} rejected, ${summary.flagged} flagged`);
  }
  return summary;
}

// ── Re-check all open cases (admin-requested) ────────────────────────────────

// Statuses a bulk re-check covers. A case whose current decision a *person*
// made is always left alone — bulk automation never overrides a staff member.
const RECHECK_STATUSES = ['pending', 'flagged'];

let recheckJob = null;

export const getRecheckJob = () => recheckJob;

/** Every open case a bulk re-check would cover → { applications, accounts, skipped }. */
async function openCasesToRecheck() {
  const [apps, personApps] = await Promise.all([
    Application.find({ status: { $in: RECHECK_STATUSES } }).sort({ createdAt: 1 }),
    KycReview.find({ subjectType: 'application', decidedBy: 'admin' }).distinct('subjectId'),
  ]);
  const personAppIds = new Set(personApps.map(String));

  const appNics = new Set((await Application.distinct('nic')).map((n) => String(n).toUpperCase()));
  const [customers, personAccounts] = await Promise.all([
    Customer.find({
      'identityDocuments.nicFront': { $exists: true },
      $or: [{ kycStatus: { $exists: false } }, { kycStatus: { $in: RECHECK_STATUSES } }],
    }).sort({ 'identityDocuments.capturedAt': 1 }),
    KycReview.find({ subjectType: 'account', decidedBy: 'admin' }).distinct('subjectId'),
  ]);
  const personAccountIds = new Set(personAccounts.map(String));
  const accounts = customers.filter((c) => !appNics.has(String(c.NIC).toUpperCase()));

  return {
    applications: apps.filter((a) => !personAppIds.has(String(a._id))),
    accounts: accounts.filter((c) => !personAccountIds.has(String(c._id))),
    skipped: apps.filter((a) => personAppIds.has(String(a._id))).length
      + accounts.filter((c) => personAccountIds.has(String(c._id))).length,
  };
}

/**
 * Starts re-checking every open (pending / flagged) case with the current rules,
 * in the background. Returns the job; only one job runs at a time.
 */
export async function startRecheckAll({ requestedBy }) {
  if (recheckJob?.running) return { job: recheckJob, started: false };

  const { applications, accounts, skipped } = await openCasesToRecheck();
  const job = {
    running: true,
    requestedBy,
    startedAt: new Date(),
    finishedAt: null,
    total: applications.length + accounts.length,
    done: 0,
    approved: 0,
    rejected: 0,
    flagged: 0,
    unchanged: 0,
    failed: 0,
    skippedByPerson: skipped,
  };
  recheckJob = job;

  const tally = (r) => {
    job.done += 1;
    if (!r.applied) job.unchanged += 1;
    else job[r.decision] += 1;
  };
  const options = { kind: 'rerun', requestedBy };

  (async () => {
    try {
      for (const app of applications) {
        try { tally(await reviewApplicationAuto(app, options)); } catch (err) {
          job.done += 1; job.failed += 1;
          console.error(`[kyc-recheck] ${app.referenceNumber} failed:`, err.message);
        }
      }
      for (const customer of accounts) {
        try { tally(await reviewAccountAuto(customer, options)); } catch (err) {
          job.done += 1; job.failed += 1;
          console.error(`[kyc-recheck] account ${customer._id} failed:`, err.message);
        }
      }
    } finally {
      job.running = false;
      job.finishedAt = new Date();
      console.log(`[kyc-recheck] re-checked ${job.done}/${job.total}: ${job.approved} approved, ${job.rejected} rejected, ${job.flagged} flagged, ${job.unchanged} unchanged, ${job.failed} failed`);
    }
  })();

  return { job, started: true };
}

/** Starts the background sweep. Set KYC_AUTO_REVIEW=off to disable. */
export function startKycAutoReviewScheduler(intervalMs = 60 * 1000) {
  if (String(process.env.KYC_AUTO_REVIEW || '').toLowerCase() === 'off') {
    console.log('[kyc-auto] automatic KYC review is switched off (KYC_AUTO_REVIEW=off)');
    return null;
  }
  const tick = () => runKycAutoReview().catch((err) => console.error('[kyc-auto] sweep failed:', err.message));
  setTimeout(tick, 8000).unref?.();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  console.log(`[kyc-auto] automatic KYC review running every ${Math.round(intervalMs / 1000)}s`);
  return timer;
}
