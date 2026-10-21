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
// Identity-photo checks for automated KYC, following the customer flow:
//
//   New customer (or existing without NIC photos)
//        → uploads NIC front + NIC back and takes a live selfie
//   Returning customer whose NIC photos are on file
//        → only takes a new live selfie; the NIC photos come from their profile
//
// Either way a case needs NIC front, NIC back and a selfie taken for *this*
// request, and the selfie must show the person on the NIC. Results:
//   pass   – proven (e.g. strong face match, all photos present and fresh)
//   fail   – proven wrong (the "selfie" is literally the NIC image file)
//   unsure – anything that cannot be proven → a person decides
// ─────────────────────────────────────────────────────────────────────────────

const IMAGES = [
  { key: 'nicFront', label: 'NIC front' },
  { key: 'nicBack', label: 'NIC back' },
  { key: 'facePhoto', label: 'live selfie' },
];

// A person-verified case is one whose status a staff member set or confirmed.
const VERIFIED_STATUSES = ['approved', 'confirmed'];

const check = (key, label, result, detail) => ({ key, label, result, detail });

const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const docsOf = (app) => ({ ...(app?.formData?.documents || {}), ...(app?.documents || {}) });
const sameIdentity = (a, b) => {
  const x = toNewFormat(a) || cleanNic(a);
  const y = toNewFormat(b) || cleanNic(b);
  return Boolean(x && y && x === y);
};

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

/**
 * @param {object} p
 * @param {'application'|'account'} p.subjectKind
 * @param {Date}   p.submittedAt   when the request / registration was made
 * @param {object} p.formDocs      documents stored on the request (may be empty)
 * @param {object} p.account       the matching Customer (lean) or null
 * @param {string} p.rawNic
 * @param {Array}  p.related       other applications of this NIC / phone (lean)
 * @returns {{ checks: object[], caseInfo: object }}
 */
export async function identityChecks({ subjectKind, submittedAt, formDocs, account, rawNic, related = [] }) {
  const checks = [];

  // 1. Where each image is, and when it was captured.
  const refs = IMAGES.map(({ key, label }) => ({
    key,
    label,
    ref: docRef(formDocs?.[key]) || docRef(account?.identityDocuments?.[key]),
  }));
  const info = await gridfsInfo(refs.map((r) => r.ref), { sniff: true });

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

  const images = {};
  const missing = [];
  const unusable = [];
  refs.forEach(({ key, label, ref }) => {
    if (!ref) { missing.push(label); images[key] = null; return; }
    if (ref.kind === 'gridfs') {
      const file = info.get(ref.id);
      if (!file) { missing.push(label); images[key] = null; return; }
      // The file's own bytes decide whether it is an image (stored types are often missing).
      if (!file.imageType || (file.length || 0) < MIN_IMAGE_BYTES) unusable.push(label);
    } else if (ref.kind === 'inline' && (!inlineImageType(ref.value) || ref.value.length * 0.75 < MIN_IMAGE_BYTES)) {
      unusable.push(label);
    }
    const seen = firstSeen.get(ref.key);
    const capturedAt = capturedAtOf(ref, info, seen && seen < new Date(submittedAt) ? seen : submittedAt);
    images[key] = { ref, capturedAt, source: captureSource(capturedAt, submittedAt) };
  });

  // 2. Which path through the customer flow this case took.
  const accountAge = account?.createdAt ? new Date(submittedAt) - new Date(account.createdAt) : 0;
  const knownBefore = accountAge > FRESH_CAPTURE_HOURS * 3600 * 1000;
  let customerType = 'unknown';
  if (subjectKind === 'account') customerType = 'new';
  else if (images.nicFront?.source === 'on-file') customerType = 'returning';
  else if (images.nicFront?.source === 'request') customerType = knownBefore ? 'existing-new-nic' : 'new';
  else if (knownBefore) customerType = 'returning'; // registered earlier, but no NIC photo at all
  else if (!account) customerType = 'new';

  // 3. Photos complete?
  const nicMissing = !images.nicFront || !images.nicBack;
  if (missing.length || unusable.length) {
    const parts = [];
    if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
    if (unusable.length) parts.push(`unreadable or too small: ${unusable.join(', ')}`);
    const hint = nicMissing && account && subjectKind === 'application'
      ? ' This customer has no NIC photos on file, so they should have been asked to upload NIC front and back.'
      : '';
    checks.push(check('documents', 'Identity photos', 'unsure', `Identity photos incomplete — ${parts.join('; ')}.${hint}`));
  } else {
    checks.push(check('documents', 'Identity photos', 'pass',
      customerType === 'returning'
        ? 'NIC front and back are on file from an earlier registration, and a live selfie was taken.'
        : 'NIC front, NIC back and a live selfie are all present and are valid images.'));
  }

  // 4. Was the selfie taken for this request?
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

  // 5. Photos uploaded by somebody else?
  if (account) {
    const foreign = await foreignOwners(refs, info, account);
    if (foreign.length) {
      checks.push(check('document_owner', 'Photos belong to this customer', 'unsure',
        `${foreign.join(', ')} ${foreign.length === 1 ? 'was' : 'were'} uploaded by a different customer account.`));
    }
  }

  // 6. The same selfie on somebody else's request.
  const reusedBy = related.filter((o) => {
    if (!o.nic || sameIdentity(o.nic, rawNic)) return false;
    return sameRef(docRef(docsOf(o).facePhoto), selfie?.ref);
  });
  if (reusedBy.length) {
    checks.push(check('selfie_reuse', 'Selfie not used by anyone else', 'unsure',
      `This exact selfie was also used on ${reusedBy.length === 1 ? 'a request' : `${reusedBy.length} requests`} for a different NIC (${[...new Set(reusedBy.map((o) => o.nic))].join(', ')}).`));
  }

  // 7. Does the selfie show the person on the NIC?
  const face = await faceCheck({ selfie, nicFront, rawNic, related });
  checks.push(face.check);

  const caseInfo = {
    customerType,
    images: Object.fromEntries(IMAGES.map(({ key }) => [key, images[key]
      ? { capturedAt: images[key].capturedAt || null, source: images[key].source }
      : null])),
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
