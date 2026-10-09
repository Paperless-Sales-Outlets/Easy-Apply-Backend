import mongoose from 'mongoose';
import Application from '../models/admin/applicationModel.js';
import Customer from '../models/Customer.js';
import KycReview from '../models/admin/kycReviewModel.js';
import { isDbConnected } from '../config/db.js';
import { cleanNic, parseNic, toNewFormat } from '../utils/sriLankaNic.js';
import { recordAudit } from './auditService.js';

// ─────────────────────────────────────────────────────────────────────────────
// Automated KYC review
//
// Decides each case from facts the system already holds, and nothing else:
//   approved – every check passed (identity can be established with certainty)
//   rejected – a definite contradiction (the NIC conflicts with the identity
//              registered for the customer)
//   flagged  – anything missing, ambiguous or suspicious → a person decides
//
// The project keeps NIC reading private and in the browser, so this service
// never sends an ID image anywhere. It therefore cannot compare the live photo
// with the NIC photo — that is reported as a "manual" check which never blocks
// approval but is always shown to the reviewer.
// ─────────────────────────────────────────────────────────────────────────────

export const SYSTEM_ACTOR_NAME = 'Automated KYC';

const NAME_FIELDS = ['nameFull', 'fullName', 'contactName', 'customerName', 'legalOwner', 'currentCustomerName', 'applicantName'];
const REQUIRED_DOCS = [
  { key: 'nicFront', label: 'NIC front' },
  { key: 'nicBack', label: 'NIC back' },
  { key: 'facePhoto', label: 'live photo' },
];
const MIN_IMAGE_BYTES = 5 * 1024;
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

// ── Documents ────────────────────────────────────────────────────────────────

function docRef(raw) {
  if (!raw) return null;
  const s = typeof raw === 'string'
    ? raw
    : raw._bsontype === 'ObjectId' || raw instanceof mongoose.Types.ObjectId ? String(raw) : raw.url || raw.fileId;
  if (typeof s !== 'string') return null;
  if (s.startsWith('data:image/')) return { kind: 'inline', size: s.length };
  const m = s.match(/^(?:gridfs:\/\/|\/api\/files\/)?([0-9a-fA-F]{24})$/);
  if (m) return { kind: 'gridfs', id: m[1] };
  if (s.startsWith('/uploads/') || /^https?:\/\//.test(s)) return { kind: 'path' };
  return null; // e.g. the DIGITALLY_VERIFIED_OTP marker
}

async function inspectDocuments(formDocs, account) {
  const refs = {};
  REQUIRED_DOCS.forEach(({ key }) => {
    refs[key] = docRef(formDocs?.[key]) || docRef(account?.identityDocuments?.[key]);
  });

  const ids = Object.values(refs).filter((r) => r?.kind === 'gridfs').map((r) => new mongoose.Types.ObjectId(r.id));
  const files = ids.length
    ? await mongoose.connection.db.collection('uploads.files').find({ _id: { $in: ids } }).toArray()
    : [];
  const byId = new Map(files.map((f) => [String(f._id), f]));

  const missing = [];
  const unusable = [];
  const foreignCandidates = []; // { label, owner } — captured under another account id
  let ownedByAccount = 0;

  REQUIRED_DOCS.forEach(({ key, label }) => {
    const ref = refs[key];
    if (!ref) { missing.push(label); return; }
    if (ref.kind === 'inline') {
      if (ref.size < MIN_IMAGE_BYTES) unusable.push(label);
      return;
    }
    if (ref.kind === 'gridfs') {
      const file = byId.get(ref.id);
      if (!file) { missing.push(label); return; }
      const type = file.contentType || file.metadata?.contentType || '';
      if (!/^image\//.test(type) || (file.length || 0) < MIN_IMAGE_BYTES) { unusable.push(label); return; }
      const owner = file.metadata?.userId ? String(file.metadata.userId) : null;
      if (account && owner) {
        if (owner === String(account._id)) ownedByAccount += 1;
        else foreignCandidates.push({ label, owner });
      }
    }
  });

  // A different owner id is only a concern when that account still exists and
  // belongs to a different person. A customer who re-registered leaves images
  // under their old (now deleted) account id, which proves nothing either way.
  const foreign = [];
  if (foreignCandidates.length) {
    const owners = await Customer
      .find({ _id: { $in: [...new Set(foreignCandidates.map((c) => c.owner))] } })
      .select('NIC')
      .lean();
    const ownerNic = new Map(owners.map((o) => [String(o._id), toNewFormat(o.NIC) || cleanNic(o.NIC)]));
    const accountNic = toNewFormat(account.NIC) || cleanNic(account.NIC);
    foreignCandidates.forEach(({ label, owner }) => {
      const theirs = ownerNic.get(owner);
      if (theirs && theirs !== accountNic) foreign.push(label);
      else ownedByAccount += 1; // same person (or an account that no longer exists)
    });
  }

  return { missing, unusable, foreign, ownedByAccount };
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

function documentChecks(docs, account) {
  const out = [];
  const problems = [];
  if (docs.missing.length) problems.push(`missing: ${docs.missing.join(', ')}`);
  if (docs.unusable.length) problems.push(`unreadable or too small: ${docs.unusable.join(', ')}`);

  out.push(problems.length
    ? check('documents', 'Identity documents', 'unsure', `Identity documents incomplete — ${problems.join('; ')}.`)
    : check('documents', 'Identity documents', 'pass', 'NIC front, NIC back and live photo are all on file and are valid images.'));

  if (account) {
    if (docs.foreign.length) {
      out.push(check('document_owner', 'Documents belong to this customer', 'unsure',
        `${docs.foreign.join(', ')} were captured on a different customer account.`));
    } else if (docs.ownedByAccount > 0) {
      out.push(check('document_owner', 'Documents belong to this customer', 'pass',
        'The ID images were captured during this customer\'s own registration.'));
    }
  }
  return out;
}

const faceCheck = () => check('face_match', 'Live photo vs NIC photo', 'manual',
  'Not machine-verified: ID images are never sent to outside services. Compare the live photo with the NIC photo yourself.');

/** pass/fail/unsure → approved / rejected / flagged. 'manual' never blocks. */
export function decide(checks) {
  if (checks.some((c) => c.result === 'fail')) return 'rejected';
  if (checks.some((c) => c.result === 'unsure')) return 'flagged';
  return 'approved';
}

export function buildRemark(decision, checks) {
  if (decision === 'approved') {
    const labels = checks.filter((c) => c.result === 'pass').map((c) => c.label.toLowerCase());
    return `Auto-approved: every automated check passed (${labels.join(', ')}). `
      + 'The live photo was not compared with the NIC photo by the system — worth a quick visual check.';
  }
  if (decision === 'rejected') {
    return `Auto-rejected: ${checks.filter((c) => c.result === 'fail').map((c) => c.detail).join(' ')}`;
  }
  return `Flagged for manual review: ${checks.filter((c) => c.result === 'unsure').map((c) => c.detail.replace(/\.$/, '')).join('; ')}.`;
}

// ── Evaluation ───────────────────────────────────────────────────────────────

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

  const docs = await inspectDocuments(fd.documents, account);
  checks.push(...documentChecks(docs, account));

  // Same NIC under a different name, or the same phone under a different NIC, elsewhere.
  const last9 = last9Of(app.phone);
  const others = await Application.find({
    _id: { $ne: app._id },
    $or: [
      ...(rawNic ? [{ nic: rawNic }] : []),
      ...(last9.length === 9 ? [{ phone: new RegExp(`${escapeRegex(last9)}$`) }] : []),
    ],
  }).select('nic phone formData').limit(40).lean();

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

  checks.push(faceCheck());
  const decision = decide(checks);
  return { decision, checks, remark: buildRemark(decision, checks) };
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

  const docs = await inspectDocuments(null, customer);
  checks.push(...documentChecks(docs, customer));
  checks.push(faceCheck());

  const decision = decide(checks);
  return { decision, checks, remark: buildRemark(decision, checks) };
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

  return KycReview.findOneAndUpdate({ subjectType, subjectId }, update, { upsert: true, new: true });
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
    { new: true }
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
    { new: true }
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
