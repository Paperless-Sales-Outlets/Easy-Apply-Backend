import Customer from '../models/Customer.js';
import KycReview from '../models/admin/kycReviewModel.js';
import { cleanNic, toNewFormat } from '../utils/sriLankaNic.js';
import {
  MIN_IMAGE_BYTES,
  FRESH_CAPTURE_HOURS,
  docRef,
  sameRef,
  gridfsInfo,
  capturedAtOf,
  captureSource,
  readImage,
  inlineImageType,
} from './kycIdentityImages.js';
import {
  analyseFace,
  faceDistance,
  getFaceEngine,
  faceMatchingEnabled,
  FACE_MATCH_MAX,
  SELFIE_MATCH_MAX,
} from './kycFaceMatchService.js';

// ─────────────────────────────────────────────────────────────────────────────
// Identity checks for automated KYC, following the customer flow:
//
//   New customer (registering)
//        → NIC front + NIC back, a live selfie and a signature.
//          Only here is the selfie compared with the NIC photo, and the NIC /
//          phone must not already belong to a registered customer.
//   Registered customer (any later request)
//        → a live selfie and a signature. Their details are checked; their
//          photos are not compared with anything (not built yet).
//
// A registration on its own (no request yet) has no signature step, so the
// signature is expected with the customer's first request instead.
// Results:
//   pass   – proven (e.g. strong face match, all photos present and fresh)
//   fail   – proven wrong (the "selfie" is the NIC image file; the NIC is
//            already registered to another customer)
//   unsure – anything that cannot be proven → a person decides
// ─────────────────────────────────────────────────────────────────────────────

const IMAGES = [
  { key: 'nicFront', label: 'NIC front' },
  { key: 'nicBack', label: 'NIC back' },
  { key: 'facePhoto', label: 'live selfie' },
];
const SIGNATURE_KEYS = ['signature', 'signatureDoc', 'customerSignature'];
const OTP_SIGNATURE = 'DIGITALLY_VERIFIED_OTP';

// A person-verified case is one whose status a staff member set or confirmed.
const VERIFIED_STATUSES = ['approved', 'confirmed'];

const check = (key, label, result, detail) => ({ key, label, result, detail });

const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const docsOf = (app) => ({ ...app?.formData?.documents, ...app?.documents });
const sameIdentity = (a, b) => {
  const x = toNewFormat(a) || cleanNic(a);
  const y = toNewFormat(b) || cleanNic(b);
  return Boolean(x && y && x === y);
};
const last9Of = (phone) => String(phone || '').replace(/\D/g, '').slice(-9);

/** Every way the same NIC can be written (old 9-digit+V/X and new 12-digit). */
function nicForms(raw) {
  const nic = cleanNic(raw);
  const asNew = toNewFormat(nic);
  const forms = new Set([nic, asNew].filter(Boolean));
  // 19YYDDD0NNNN ↔ YYDDDNNNN + V / X
  if (asNew && /^19\d{2}\d{3}0\d{4}$/.test(asNew)) {
    const old = `${asNew.slice(2, 4)}${asNew.slice(4, 7)}${asNew.slice(8, 12)}`;
    forms.add(`${old}V`);
    forms.add(`${old}X`);
  }
  return [...forms];
}

/** Who uploaded a GridFS image, when that owner is a *different* existing person. */
async function foreignOwners(refs, info, account) {
  if (!account) return [];
  const candidates = [];
  refs.forEach(({ label, ref }) => {
    const owner = ref?.kind === 'gridfs' ? info.get(ref.id)?.metadata?.userId : null;
    if (owner && String(owner) !== String(account._id)) candidates.push({ label, owner: String(owner) });
  });
  if (!candidates.length) return [];
  // A customer who re-registered leaves images under their old (deleted) account
  // id — that proves nothing, so only a still-existing, different person counts.
  const owners = await Customer.find({ _id: { $in: [...new Set(candidates.map((c) => c.owner))] } }).select('NIC').lean();
  const ownerNic = new Map(owners.map((o) => [String(o._id), o.NIC]));
  return candidates.filter((c) => ownerNic.has(c.owner) && !sameIdentity(ownerNic.get(c.owner), account.NIC)).map((c) => c.label);
}

/** A new registration must not reuse a registered customer's NIC or phone. */
async function notAlreadyRegistered({ rawNic, phone, account }) {
  const forms = rawNic ? nicForms(rawNic) : [];
  const last9 = last9Of(phone);
  const or = [
    ...(forms.length ? [{ NIC: { $in: forms } }] : []),
    ...(last9.length === 9 ? [{ phone: new RegExp(`${last9}$`) }] : []),
  ];
  if (!or.length) return null;
  const others = await Customer.find({ ...(account ? { _id: { $ne: account._id } } : {}), $or: or })
    .select('NIC phone createdAt')
    .lean();

  const byNic = others.find((o) => sameIdentity(o.NIC, rawNic));
  if (byNic) {
    return check('not_registered', 'Not already registered', 'fail',
      `NIC ${rawNic} is already registered to another customer account${byNic.createdAt ? ` (registered ${fmtDate(byNic.createdAt)})` : ''}. A registered customer cannot register again as a new customer.`);
  }
  const byPhone = others.find((o) => last9Of(o.phone) === last9);
  if (byPhone) {
    return check('not_registered', 'Not already registered', 'unsure',
      `Phone ${phone} already belongs to another registered customer (NIC ${byPhone.NIC || 'not recorded'}). It may be a shared family number — check that this is really a new customer.`);
  }
  return check('not_registered', 'Not already registered', 'pass',
    'This NIC and phone number do not belong to any other registered customer.');
}

/** The signature on a request → { state: 'image'|'otp'|'none', ref } */
function signatureOf(formDocs, extraSignature) {
  const raws = [...SIGNATURE_KEYS.map((k) => formDocs?.[k]), extraSignature];
  for (const raw of raws) {
    const ref = docRef(raw);
    if (ref) return { state: 'image', ref };
  }
  return raws.some((r) => r === OTP_SIGNATURE) ? { state: 'otp', ref: null } : { state: 'none', ref: null };
}

/**
 * @param {object} p
 * @param {'application'|'account'} p.subjectKind
 * @param {Date}   p.submittedAt   when the request / registration was made
 * @param {object} p.formDocs      documents stored on the request (may be empty)
 * @param {string} p.formSignature the request's own signature field, if any
 * @param {object} p.account       the matching Customer (lean) or null
 * @param {string} p.rawNic
 * @param {string} p.phone
 * @param {Array}  p.related       other applications of this NIC / phone (lean)
 * @returns {{ checks: object[], caseInfo: object }}
 */
export async function identityChecks({ subjectKind, submittedAt, formDocs, formSignature, account, rawNic, phone, related = [] }) {
  const checks = [];

  // 1. New registration or registered customer?
  // Registered = the account existed before this request (outside the capture window).
  const accountAge = account?.createdAt ? new Date(submittedAt) - new Date(account.createdAt) : null;
  const registered = subjectKind === 'application' && Boolean(account)
    && (accountAge === null || accountAge > FRESH_CAPTURE_HOURS * 3600 * 1000);
  const customerType = registered ? 'registered' : 'new';

  // 2. Where each image is, and when it was captured.
  const refs = IMAGES.map(({ key, label }) => ({
    key,
    label,
    ref: docRef(formDocs?.[key]) || docRef(account?.identityDocuments?.[key]),
  }));
  const signature = subjectKind === 'application' ? signatureOf(formDocs, formSignature) : { state: 'none', ref: null };
  const info = await gridfsInfo([...refs.map((r) => r.ref), signature.ref], { sniff: true });

  // Images without a date of their own (inline / file paths) date from the
  // earliest request that already carried them, else from this one.
  const firstSeen = new Map();
  related.forEach((o) => {
    const docs = docsOf(o);
    IMAGES.forEach(({ key }) => {
      const r = docRef(docs[key]);
      if (!r) return;
      const prev = firstSeen.get(r.key);
      if (!prev || new Date(o.createdAt) < prev) firstSeen.set(r.key, new Date(o.createdAt));
    });
  });

  const usable = (ref) => {
    if (!ref) return 'missing';
    if (ref.kind === 'gridfs') {
      const file = info.get(ref.id);
      if (!file) return 'missing';
      // The file's own bytes decide whether it is an image (stored types are often missing).
      return file.imageType && (file.length || 0) >= MIN_IMAGE_BYTES ? 'ok' : 'unusable';
    }
    if (ref.kind === 'inline') return inlineImageType(ref.value) && ref.value.length * 0.75 >= MIN_IMAGE_BYTES ? 'ok' : 'unusable';
    return 'ok'; // a stored file path — read when needed
  };

  const images = {};
  const imageState = {};
  refs.forEach(({ key, ref }) => {
    imageState[key] = usable(ref);
    if (imageState[key] === 'missing') { images[key] = null; return; }
    const seen = firstSeen.get(ref.key);
    const capturedAt = capturedAtOf(ref, info, seen && seen < new Date(submittedAt) ? seen : submittedAt);
    images[key] = { ref, capturedAt, source: captureSource(capturedAt, submittedAt) };
  });

  // 3. The photos this kind of customer must provide.
  const required = registered ? ['facePhoto'] : ['nicFront', 'nicBack', 'facePhoto'];
  const missing = required.filter((k) => imageState[k] === 'missing').map((k) => IMAGES.find((i) => i.key === k).label);
  const unusable = required.filter((k) => imageState[k] === 'unusable').map((k) => IMAGES.find((i) => i.key === k).label);
  if (missing.length || unusable.length) {
    const parts = [];
    if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
    if (unusable.length) parts.push(`unreadable or too small: ${unusable.join(', ')}`);
    checks.push(check('documents', 'Required photos', 'unsure',
      `${registered ? 'A registered customer needs a live selfie' : 'A new customer needs NIC front, NIC back and a live selfie'} — ${parts.join('; ')}.`));
  } else {
    checks.push(check('documents', 'Required photos', 'pass', registered
      ? 'A live selfie was provided (NIC photos are not needed from a registered customer).'
      : 'NIC front, NIC back and a live selfie are all present and are valid images.'));
  }

  // 4. Signature — every request needs one. (A registration alone has no
  // signature step; the signature comes with the first request.)
  if (subjectKind === 'application') {
    const sigState = signature.state === 'image' ? usable(signature.ref) : signature.state;
    if (sigState === 'ok') {
      checks.push(check('signature', 'Signature', 'pass', 'A signature was provided with this request.'));
    } else if (sigState === 'otp') {
      checks.push(check('signature', 'Signature', 'unsure', 'No signature was drawn — the request was only confirmed by OTP.'));
    } else if (sigState === 'unusable') {
      checks.push(check('signature', 'Signature', 'unsure', 'The signature image is unreadable or too small.'));
    } else {
      checks.push(check('signature', 'Signature', 'unsure', 'No signature was provided with this request.'));
    }
  }

  // 5. Was the selfie taken for this request?
  const selfie = images.facePhoto;
  const nicFront = images.nicFront;
  const nicBack = images.nicBack;
  if (selfie && (sameRef(selfie.ref, nicFront?.ref) || sameRef(selfie.ref, nicBack?.ref))) {
    checks.push(check('selfie_fresh', 'Live selfie for this request', 'fail',
      'The "live selfie" is the same image file as the NIC photo, so it is not a live capture.'));
  } else if (!selfie) {
    checks.push(check('selfie_fresh', 'Live selfie for this request', 'unsure', 'No live selfie was provided.'));
  } else if (selfie.source === 'request') {
    checks.push(check('selfie_fresh', 'Live selfie for this request', 'pass',
      subjectKind === 'account' ? 'The selfie was taken during registration.' : 'The selfie was taken for this request.'));
  } else if (selfie.source === 'on-file') {
    checks.push(check('selfie_fresh', 'Live selfie for this request', 'unsure',
      `No new selfie was taken for this request — the only selfie is from ${fmtDate(selfie.capturedAt)}.`));
  } else {
    checks.push(check('selfie_fresh', 'Live selfie for this request', 'unsure', 'It cannot be told when the selfie was taken.'));
  }

  // 6. Photos uploaded by somebody else?
  if (account) {
    const foreign = await foreignOwners(refs.filter((r) => required.includes(r.key)), info, account);
    if (foreign.length) {
      checks.push(check('document_owner', 'Photos belong to this customer', 'unsure',
        `${foreign.join(', ')} ${foreign.length === 1 ? 'was' : 'were'} uploaded by a different customer account.`));
    }
  }

  // 7. The same selfie on somebody else's request.
  const reusedBy = related.filter((o) => {
    if (!o.nic || sameIdentity(o.nic, rawNic)) return false;
    return sameRef(docRef(docsOf(o).facePhoto), selfie?.ref);
  });
  if (reusedBy.length) {
    checks.push(check('selfie_reuse', 'Selfie not used by anyone else', 'unsure',
      `This exact selfie was also used on ${reusedBy.length === 1 ? 'a request' : `${reusedBy.length} requests`} for a different NIC (${[...new Set(reusedBy.map((o) => o.nic))].join(', ')}).`));
  }

  // 8. New customers only: not already registered, and the selfie shows the person on the NIC.
  let face = { info: null };
  if (!registered) {
    const unique = await notAlreadyRegistered({ rawNic, phone, account });
    if (unique) checks.push(unique);
    face = await faceCheck({ selfie, nicFront, rawNic, related });
    checks.push(face.check);
  }

  const caseInfo = {
    customerType,
    images: Object.fromEntries(IMAGES.map(({ key }) => [key, images[key]
      ? { capturedAt: images[key].capturedAt || null, source: images[key].source }
      : null])),
    required: subjectKind === 'application' ? [...required, 'signature'] : required,
    signature: subjectKind === 'application' ? (signature.state === 'image' ? usable(signature.ref) : signature.state) : null,
    face: face.info,
  };
  return { checks, caseInfo };
}

async function verifiedSelfies(selfieRef, rawNic, related) {
  const candidates = related.filter((o) => VERIFIED_STATUSES.includes(o.status) && sameIdentity(o.nic, rawNic));
  if (!candidates.length) return [];
  // Only a decision a *person* made (or confirmed) makes that selfie a trusted reference.
  const personal = await KycReview.find({
    subjectType: 'application',
    subjectId: { $in: candidates.map((o) => o._id) },
    decidedBy: 'admin',
  }).select('subjectId').lean();
  const ok = new Set(personal.map((r) => String(r.subjectId)));
  return candidates
    .filter((o) => ok.has(String(o._id)))
    .map((o) => ({ app: o, ref: docRef(docsOf(o).facePhoto) }))
    .filter((c) => c.ref && !sameRef(c.ref, selfieRef))
    .sort((a, b) => new Date(b.app.createdAt) - new Date(a.app.createdAt))
    .slice(0, 2);
}

const FACE_LABEL = 'Selfie matches the NIC photo';

async function faceCheck({ selfie, nicFront, rawNic, related }) {
  const unsure = (detail, info = {}) => ({ check: check('face_match', FACE_LABEL, 'unsure', detail), info: { result: 'unsure', ...info } });

  if (!faceMatchingEnabled()) return unsure('Automatic face matching is switched off on this server (KYC_FACE_MATCH=off) — compare the faces yourself.');
  if (!selfie) return unsure('There is no selfie to compare with the NIC photo.');
  if (!(await getFaceEngine())) return unsure('Face matching could not start on this server — compare the faces yourself. (Run npm install in the backend.)');

  const selfieImg = await readImage(selfie.ref);
  if (!selfieImg) return unsure('The selfie image could not be read.');
  const s = await analyseFace(selfieImg.buffer, { kind: 'selfie', hash: selfieImg.hash });
  if (!s.ok) return unsure('The selfie image could not be read.');
  if (!s.face) return unsure('No face could be found in the selfie.');
  // Faces at least half the size of the main one are other people in the frame, not background.
  if (s.all.filter((f) => f.size >= s.face.size * 0.5).length > 1) {
    return unsure('More than one face is visible in the selfie.');
  }

  let nicDistance = null;
  let nicProblem = null;
  if (nicFront) {
    const nicImg = await readImage(nicFront.ref);
    if (nicImg && nicImg.hash === selfieImg.hash) {
      return { check: check('face_match', FACE_LABEL, 'fail', 'The selfie is the same picture as the NIC photo, so it is not a live capture.'), info: { result: 'fail' } };
    }
    const n = nicImg ? await analyseFace(nicImg.buffer, { kind: 'nic', hash: nicImg.hash }) : { ok: false };
    if (!n.ok) nicProblem = 'the NIC photo could not be read';
    else if (!n.face) nicProblem = 'no face could be found on the NIC photo';
    else nicDistance = faceDistance(s.face.descriptor, n.face.descriptor);
  } else {
    nicProblem = 'there is no NIC front photo';
  }

  const round = (d) => Math.round(d * 1000) / 1000;
  if (nicDistance !== null && nicDistance <= FACE_MATCH_MAX) {
    return {
      check: check('face_match', FACE_LABEL, 'pass',
        `Strong match between the selfie and the NIC photo (difference ${round(nicDistance)}; automatic pass needs ${FACE_MATCH_MAX} or less).`),
      info: { result: 'pass', against: 'nic', distance: round(nicDistance), threshold: FACE_MATCH_MAX },
    };
  }

  // NIC photos are small, printed and often years old — a selfie a person has
  // already verified for this NIC is a second, fair reference.
  for (const ref of await verifiedSelfies(selfie.ref, rawNic, related)) {
    const img = await readImage(ref.ref);
    if (!img || img.hash === selfieImg.hash) continue;
    const r = await analyseFace(img.buffer, { kind: 'selfie', hash: img.hash });
    if (!r.ok || !r.face) continue;
    const d = faceDistance(s.face.descriptor, r.face.descriptor);
    if (d !== null && d <= SELFIE_MATCH_MAX) {
      return {
        check: check('face_match', FACE_LABEL, 'pass',
          `Strong match with the selfie a staff member verified on ${ref.app.referenceNumber} (difference ${round(d)}; automatic pass needs ${SELFIE_MATCH_MAX} or less)`
          + (nicDistance !== null ? `. The NIC photo itself was a weaker match (${round(nicDistance)}).` : `, although ${nicProblem}.`)),
        info: {
          result: 'pass', against: 'selfie', distance: round(d), threshold: SELFIE_MATCH_MAX,
          nicDistance: nicDistance === null ? null : round(nicDistance),
          referenceId: String(ref.app._id), referenceNumber: ref.app.referenceNumber,
        },
      };
    }
  }

  if (nicDistance === null) return unsure(`The faces could not be compared — ${nicProblem}. Compare them yourself.`);
  return unsure(
    `Not a strong enough match between the selfie and the NIC photo (difference ${round(nicDistance)}; automatic pass needs ${FACE_MATCH_MAX} or less). Compare the faces yourself.`,
    { against: 'nic', distance: round(nicDistance), threshold: FACE_MATCH_MAX },
  );
}
