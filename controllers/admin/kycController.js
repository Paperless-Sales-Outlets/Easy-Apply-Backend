import Application from '../../models/admin/applicationModel.js';
import Customer from '../../models/Customer.js';
import KycReview from '../../models/admin/kycReviewModel.js';
import { getSignedFileUrl, downloadBuffer, extractStorageKey } from '../../services/storageService.js';
import {
  reviewApplicationAuto,
  reviewAccountAuto,
  runKycAutoReview,
  startRecheckAll,
  getRecheckJob,
} from '../../services/kycAutoReviewService.js';
import { recordAudit } from '../../services/auditService.js';
import { query, toCamelCase } from '../../config/db.js';
import { buildWhereClause } from '../../db/modelHelper.js';
import {
  FRESH_CAPTURE_HOURS,
  docRef,
  gridfsInfo,
  capturedAtOf,
  captureSource,
} from '../../services/kycIdentityImages.js';

const NAME_FIELDS = [
  'nameFull',
  'fullName',
  'contactName',
  'customerName',
  'legalOwner',
  'currentCustomerName',
  'applicantName',
];

const DOC_KEYS = [
  { key: 'passportDoc',       label: 'Passport' },
  { key: 'nicFront',          label: 'NIC Front' },
  { key: 'nicBack',           label: 'NIC Back' },
  { key: 'facePhoto',         label: 'Live Face Photo' },
  { key: 'signature',         label: 'Digital Signature' },
  { key: 'signatureDoc',      label: 'Digital Signature' },
  { key: 'customerSignature', label: 'Customer Signature' },
  { key: 'brcDoc',            label: 'Business Registration' },
  { key: 'vatDoc',            label: 'VAT Certificate' },
  { key: 'taxExemptionDoc',   label: 'Tax Exemption Certificate' },
];

const REVIEW_STATUSES = ['pending', 'pending payment', 'flagged'];
const DECIDED_LIMIT = 100;

// 'confirmed' means payment / the installation appointment is already done, so
// the KYC decision is final and can no longer be changed from this screen.
const LOCKED_STATUS = 'confirmed';

function pick(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

const resolveDocUrl = async (raw) => {
  if (!raw) return null;
  // ObjectId instances (copied from Customer.identityDocuments) stringify to 24-hex
  const url = typeof raw === 'string'
    ? raw
    : raw?._bsontype === 'ObjectId' ? String(raw) : raw?.url || raw?.fileId;
  if (!url || typeof url !== 'string') return null;

  // GridFS reference uri: gridfs://<objectId>
  if (url.startsWith('gridfs://')) {
    return `/api/files/${url.replace('gridfs://', '')}`;
  }

  // Raw MongoDB 24-character ObjectId
  if (/^[0-9a-fA-F]{24}$/.test(url)) {
    return `/api/files/${url}`;
  }

  // Base64 Data URL (e.g. data:image/png;base64,... or data:image/jpeg;base64,...)
  if (url.startsWith('data:image/')) {
    return url;
  }

  // Standard absolute HTTP/HTTPS URL
  if (/^https?:\/\//.test(url) || url.startsWith('/api/files/')) {
    return url;
  }

  // Local uploads or S3 path — anything else (e.g. the 'DIGITALLY_VERIFIED_OTP' marker) is not a file
  if (!url.startsWith('/uploads/')) return null;
  return await getSignedFileUrl(url);
};

/**
 * Inline base64 images can be several MB each, which made the review list
 * take ~10s to load. The list carries a URL to fetch them on demand instead.
 */
const lazyDocUrl = (url, subjectId, key) =>
  url && url.startsWith('data:') ? `/api/admin/kyc/${subjectId}/document/${key}` : url;

// ── List queries ─────────────────────────────────────────────────────────────
// Images are stored as base64 text inside the JSON columns (up to several MB a
// row), and the list only needs to know one exists: the bytes are fetched by
// getKycDocument when a case is opened. These read everything the list uses and
// cut each inline image down to its "data:image/..." prefix inside the database.
// Each JSON column is walked once with jsonb_each: every separate column->'key'
// would make Postgres unpack the whole multi-MB value again.
const trimInline = (v) =>
  `CASE WHEN jsonb_typeof(${v}) = 'string' AND left(${v} #>> '{}', 5) = 'data:' THEN to_jsonb(left(${v} #>> '{}', 32)) ELSE ${v} END`;

const pickFrom = (json, keys, alias, valueOf = trimInline) => `COALESCE((
  SELECT jsonb_object_agg(${alias}.k, ${valueOf(`${alias}.v`)})
  FROM jsonb_each(CASE WHEN jsonb_typeof(${json}) = 'object' THEN ${json} END) AS ${alias}(k, v)
  WHERE ${alias}.k = ANY(ARRAY[${keys.map((key) => `'${key}'`).join(', ')}])
), '{}'::jsonb)`;

const DOC_FIELD_KEYS = DOC_KEYS.map(({ key }) => key);

const LIST_APPLICATION_COLUMNS = [
  'id', 'reference_number', 'phone', 'nic', 'service_type', 'status', 'notes',
  'actioned_at', 'actioned_by', 'created_at', 'updated_at',
  `${pickFrom('documents', DOC_FIELD_KEYS, 'd')} AS documents`,
  `${pickFrom('form_data', [...DOC_FIELD_KEYS, ...NAME_FIELDS, 'documents'], 'f', (v) =>
    `CASE WHEN f.k = 'documents' THEN ${pickFrom(v, DOC_FIELD_KEYS, 'n')} ELSE ${trimInline(v)} END`)} AS form_data`,
].join(', ');

const LIST_CUSTOMER_COLUMNS = [
  'id', 'name', 'nic', 'phone', 'kyc_status', 'kyc_notes', 'kyc_actioned_at', 'created_at', 'updated_at',
  `${pickFrom('identity_documents', [...DOC_FIELD_KEYS, 'capturedAt'], 'i')} AS identity_documents`,
].join(', ');

async function listRows(table, columns, filter, suffix = '') {
  const { whereText, values } = buildWhereClause(filter);
  const { rows } = await query(`SELECT ${columns} FROM ${table} ${whereText} ${suffix}`, values);
  return rows.map((row) => {
    const item = toCamelCase(row);
    return item.nic ? { ...item, NIC: item.nic } : item;
  });
}

const last9Digits = (phone) => String(phone || '').replace(/\D/g, '').slice(-9);

/** One lookup for a whole list, in place of one findLinkedCustomer per application. */
async function linkedCustomersFor(apps) {
  const nics = [...new Set(apps.map((a) => a.nic?.toUpperCase()).filter(Boolean))];
  const phones = [...new Set(apps.map((a) => last9Digits(a.phone)).filter(Boolean))];
  if (!nics.length && !phones.length) return () => null;

  const { rows } = await query(
    `SELECT ${LIST_CUSTOMER_COLUMNS} FROM customers
     WHERE nic = ANY($1) OR right(regexp_replace(phone, '\\D', '', 'g'), 9) = ANY($2)`,
    [nics, phones]
  );
  const customers = rows.map((row) => ({ ...toCamelCase(row), NIC: row.nic }));
  const byNic = new Map(customers.filter((c) => c.NIC).map((c) => [c.NIC, c]));
  const byPhone = new Map(customers.map((c) => [last9Digits(c.phone), c]));
  return (app) => byNic.get(app.nic?.toUpperCase()) || byPhone.get(last9Digits(app.phone)) || null;
}

/** The customer profile linked to an application by NIC or phone (null if none or lookup fails). */
async function findLinkedCustomer(app) {
  try {
    const last9 = String(app.phone || '').replace(/\D/g, '').slice(-9);
    return await Customer.findOne({
      $or: [
        ...(app.nic ? [{ NIC: app.nic.toUpperCase() }] : []),
        ...(last9 ? [{ phone: new RegExp(`${last9}$`) }] : []),
      ],
    }).lean();
  } catch (err) {
    console.warn('[KYC] Linked customer lookup failed:', err.message);
    return null;
  }
}

/** Raw stored value for one document of an application, falling back to the customer's captured identity images. */
function rawAppDoc(app, customerProfile, key) {
  const fd = app.formData || {};
  const docs = fd.documents && typeof fd.documents === 'object' ? fd.documents : {};
  let raw = docs[key] ?? app.documents?.[key] ?? fd[key];
  if (key === 'signature' && !raw) raw = fd.signature;
  if (!raw && customerProfile?.identityDocuments?.[key]) raw = customerProfile.identityDocuments[key];
  return raw;
}

const IDENTITY_KEYS = ['nicFront', 'nicBack', 'facePhoto'];
const USER_DOC_KEYS = DOC_KEYS.filter(({ key }) => ['nicFront', 'nicBack', 'facePhoto', 'signature', 'signatureDoc'].includes(key));

// Customer who registered (NIC + live photo captured) but has no application yet.
// The audit fields every queue item carries: who decided, the automated
// checks and the full history of changes.
function reviewView(review, legacy) {
  if (!review) {
    return {
      decidedBy: legacy?.by || null,
      decidedByName: legacy?.name || '',
      decidedAt: legacy?.at || null,
      autoDecision: null,
      autoCheckedAt: null,
      checks: [],
      history: [],
      caseInfo: null,
    };
  }
  return {
    decidedBy: review.decidedBy || legacy?.by || null,
    decidedByName: review.decidedBy ? review.decidedByName : legacy?.name || '',
    decidedAt: review.decidedBy ? review.decidedAt : legacy?.at || null,
    autoDecision: review.autoDecision || null,
    autoCheckedAt: review.autoCheckedAt || null,
    checks: (review.checks || []).map((c) => ({ key: c.key, label: c.label, result: c.result, detail: c.detail })),
    caseInfo: review.caseInfo || null,
    history: (review.history || []).map((h) => ({
      at: h.at,
      actor: h.actor,
      actorName: h.actorName,
      kind: h.kind,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      remark: h.remark,
    })).reverse(),
  };
}

async function customerToQueueItem(customer, review) {
  const documents = [];
  const identityRaw = {};
  for (const { key, label } of USER_DOC_KEYS) {
    const raw = customer.identityDocuments?.[key];
    const url = await resolveDocUrl(raw);
    if (url) {
      documents.push({ key, label, url: lazyDocUrl(url, customer._id, key) });
      identityRaw[key] = raw;
    }
  }
  return {
    _identityRaw: identityRaw,
    _accountCreatedAt: customer.createdAt || null,
    id: customer._id,
    kind: 'account',
    referenceNumber: 'ACCOUNT',
    name: customer.name,
    nic: customer.NIC,
    phone: customer.phone,
    serviceType: 'account-registration',
    status: customer.kycStatus || 'pending',
    submittedAt: customer.identityDocuments?.capturedAt || customer.createdAt,
    updatedAt: customer.updatedAt,
    notes: customer.kycNotes || '',
    actionedAt: customer.kycActionedAt || null,
    actionedBy: null,
    locked: false,
    signatureMode: null,
    ...reviewView(review, customer.kycActionedAt && customer.kycStatus && customer.kycStatus !== 'pending'
      ? { by: 'admin', name: '', at: customer.kycActionedAt }
      : null),
    documents,
  };
}

async function toQueueItem(app, review, linkedCustomer) {
  const fd = app.formData || {};
  const docs = fd.documents && typeof fd.documents === 'object' ? fd.documents : {};

  // Linked customer profile — holds the NIC + live face photo captured at registration
  const customerProfile = linkedCustomer === undefined ? await findLinkedCustomer(app) : linkedCustomer;

  const documents = [];
  const identityRaw = {};
  for (const { key, label } of DOC_KEYS) {
    const raw = rawAppDoc(app, customerProfile, key);
    const resolved = await resolveDocUrl(raw);
    if (resolved) {
      documents.push({ key, label, url: lazyDocUrl(resolved, app._id, key) });
      if (IDENTITY_KEYS.includes(key)) identityRaw[key] = raw;
    }
  }

  return {
    _identityRaw: identityRaw,
    _accountCreatedAt: customerProfile?.createdAt || null,
    id: app._id,
    referenceNumber: app.referenceNumber,
    name: pick(fd, NAME_FIELDS) || customerProfile?.name || 'Unknown',
    nic: app.nic || customerProfile?.NIC,
    phone: app.phone || customerProfile?.phone,
    serviceType: app.serviceType,
    status: app.status,
    submittedAt: app.createdAt,
    updatedAt: app.updatedAt,
    notes: app.notes || '',
    actionedAt: app.actionedAt || null,
    actionedBy: app.actionedBy
      ? { name: app.actionedBy.name, email: app.actionedBy.email, role: app.actionedBy.role }
      : null,
    locked: app.status === LOCKED_STATUS,
    signatureMode: [docs.signature, fd.signature].includes('DIGITALLY_VERIFIED_OTP') ? 'otp' : null,
    ...reviewView(review, app.actionedBy
      ? { by: 'admin', name: app.actionedBy.name || app.actionedBy.email || '', at: app.actionedAt }
      : null),
    documents,
  };
}

// Adds, for every queue item: when each identity photo was captured, whether it
// came with this request or was already on file, the customer type (new or
// returning) and — when the face check used one — the selfie a staff member
// verified earlier. One GridFS lookup serves the whole list.
async function annotateIdentity(items) {
  const refsByItem = items.map((item) => Object.fromEntries(
    Object.entries(item._identityRaw || {}).map(([k, raw]) => [k, docRef(raw)])
  ));
  const info = await gridfsInfo(refsByItem.flatMap((r) => Object.values(r)));

  const referenceIds = [...new Set(items
    .map((i) => i.caseInfo?.face?.against === 'selfie' && i.caseInfo.face.referenceId)
    .filter(Boolean))];
  const referenceApps = referenceIds.length
    ? await listRows('applications', LIST_APPLICATION_COLUMNS, { _id: { $in: referenceIds } })
    : [];
  const referenceUrl = new Map();
  for (const ref of referenceApps) {
    const docs = { ...ref.formData?.documents, ...ref.documents };
    const url = lazyDocUrl(await resolveDocUrl(docs.facePhoto), ref._id, 'facePhoto');
    if (url) referenceUrl.set(String(ref._id), { url, referenceNumber: ref.referenceNumber, capturedAt: ref.createdAt });
  }

  return items.map((item, idx) => {
    const { _identityRaw, _accountCreatedAt, ...rest } = item;
    const stored = item.caseInfo?.images || {};
    const refs = refsByItem[idx];
    const live = {};
    Object.entries(refs).forEach(([key, ref]) => {
      // The automated run also dates inline / path images by earlier requests,
      // so its answer wins when it has one for this same image.
      const capturedAt = stored[key]?.capturedAt || capturedAtOf(ref, info, item.submittedAt);
      live[key] = { capturedAt, source: stored[key]?.source || captureSource(capturedAt, item.submittedAt) };
    });

    // 'new' = registering now; 'registered' = the account existed before this request.
    // Older automated runs stored 'returning' / 'existing-new-nic' — both are registered customers.
    let customerType = item.caseInfo?.customerType || null;
    if (customerType === 'returning' || customerType === 'existing-new-nic') customerType = 'registered';
    if (!customerType) {
      if (item.kind === 'account') customerType = 'new';
      else if (_accountCreatedAt) {
        const age = new Date(item.submittedAt) - new Date(_accountCreatedAt);
        customerType = age > FRESH_CAPTURE_HOURS * 3600 * 1000 ? 'registered' : 'new';
      } else customerType = 'unknown';
    }

    return {
      ...rest,
      customerType,
      documents: rest.documents.map((d) => (live[d.key] ? { ...d, ...live[d.key] } : d)),
      referenceSelfie: referenceUrl.get(String(item.caseInfo?.face?.referenceId)) || null,
    };
  });
}

// Reviews for a batch of subjects, keyed by id.
async function reviewsFor(subjectType, ids) {
  if (!ids.length) return new Map();
  const reviews = await KycReview.find({ subjectType, subjectId: { $in: ids } }).lean();
  return new Map(reviews.map((r) => [String(r.subjectId), r]));
}

// Audit-log entries must never turn an already-saved decision into an error.
async function audit(payload) {
  try {
    await recordAudit(payload);
  } catch (err) {
    console.error('[kyc] audit log failed:', err.message);
  }
}

const reviewerOf = (req) => {
  const user = req.customer || req.user;
  return { id: user?._id || null, name: user?.name || user?.email || 'Admin' };
};

// @desc    The KYC review list: every case still waiting for a decision, plus
//          recent decided cases (so automated decisions can be checked and changed)
// @route   GET /api/admin/kyc
// @access  Private (Admin / Staff only)
export const getKycQueue = async (req, res, next) => {
  try {
    const reviewedAppIds = await KycReview.find({ subjectType: 'application' }).distinct('subjectId');

    const [open, decided] = await Promise.all([
      listRows('applications', LIST_APPLICATION_COLUMNS, { status: { $in: REVIEW_STATUSES } }, 'ORDER BY created_at ASC'),
      listRows(
        'applications',
        LIST_APPLICATION_COLUMNS,
        {
          status: { $in: ['approved', 'rejected', LOCKED_STATUS] },
          $or: [{ _id: { $in: reviewedAppIds } }, { actionedBy: { $ne: null } }],
        },
        `ORDER BY updated_at DESC LIMIT ${DECIDED_LIMIT}`
      ),
    ]);

    const applications = [...open, ...decided];
    const [appReviews, linkedCustomerOf] = await Promise.all([
      reviewsFor('application', applications.map((a) => a._id)),
      linkedCustomersFor(applications),
    ]);
    const queue = await Promise.all(applications.map(
      (a) => toQueueItem(a, appReviews.get(String(a._id)), linkedCustomerOf(a))
    ));

    // Registered customers with captured ID images and no application yet — once they
    // apply, the application (in any status) carries the decision
    const covered = new Set((await Application.distinct('nic')).map((n) => String(n).toUpperCase()));
    const reviewedAccountIds = await KycReview.find({ subjectType: 'account' }).distinct('subjectId');
    const customers = await listRows(
      'customers',
      LIST_CUSTOMER_COLUMNS,
      {
        'identityDocuments.nicFront': { $exists: true },
        $or: [
          { kycStatus: { $exists: false } },
          { kycStatus: { $in: REVIEW_STATUSES } },
          { kycStatus: { $in: ['approved', 'rejected'] }, _id: { $in: reviewedAccountIds } },
          { kycStatus: { $in: ['approved', 'rejected'] }, kycActionedAt: { $ne: null } },
        ],
      },
      `ORDER BY (identity_documents->>'capturedAt') ASC LIMIT ${DECIDED_LIMIT * 2}`
    );
    const accountCustomers = customers.filter((u) => !covered.has(String(u.NIC).toUpperCase()));
    const accountReviews = await reviewsFor('account', accountCustomers.map((c) => c._id));
    const accounts = await Promise.all(accountCustomers.map((c) => customerToQueueItem(c, accountReviews.get(String(c._id)))));

    const all = await annotateIdentity([...queue, ...accounts]);
    res.status(200).json({ success: true, count: all.length, queue: all });
  } catch (error) {
    next(error);
  }
};

// @desc    Stream one inline (base64) document image of a KYC case
// @route   GET /api/admin/kyc/:id/document/:key
// @access  Private (Admin / Staff only)
export const getKycDocument = async (req, res, next) => {
  try {
    const { id, key } = req.params;
    if (!DOC_KEYS.some((d) => d.key === key)) {
      return res.status(400).json({ success: false, message: 'Unknown document type.' });
    }
    const subject = await loadSubject(id);
    if (!subject) {
      return res.status(404).json({ success: false, message: 'KYC case not found.' });
    }

    const raw = subject.type === 'application'
      ? rawAppDoc(subject.doc, await findLinkedCustomer(subject.doc), key)
      : subject.doc.identityDocuments?.[key];

    if (!raw) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }

    // A. Inline base64 data URL
    if (typeof raw === 'string' && raw.startsWith('data:image/')) {
      const match = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/.exec(raw);
      if (match) {
        res.set('Content-Type', match[1]);
        res.set('Cache-Control', 'private, max-age=300');
        return res.send(Buffer.from(match[2], 'base64'));
      }
    }

    // B. Stored cloud object (decrypt on the fly from Supabase storage)
    try {
      const { buffer, isEncrypted } = await downloadBuffer(raw);
      let contentType = 'image/jpeg';
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        contentType = 'image/png';
      } else if (buffer.toString('ascii', 0, 4) === 'RIFF') {
        contentType = 'image/webp';
      } else if (buffer.toString('ascii', 0, 4) === '%PDF') {
        contentType = 'application/pdf';
      }

      res.set('Content-Type', contentType);
      res.set('Content-Length', buffer.length);
      res.set('Cache-Control', 'private, max-age=300');
      if (isEncrypted) res.set('x-decrypted-at-rest', 'true');
      return res.send(buffer);
    } catch (storageErr) {
      console.warn(`[getKycDocument] storage fetch failed for "${raw}": ${storageErr.message}`);
      return res.status(404).json({ success: false, message: 'Document image not found.' });
    }
  } catch (error) {
    next(error);
  }
};

async function loadSubject(id) {
  if (!id || typeof id !== 'string') return null;
  const application = await Application.findById(id);
  if (application) return { type: 'application', doc: application };
  const customer = await Customer.findById(id);
  return customer ? { type: 'account', doc: customer } : null;
}

async function itemFor(subject) {
  if (subject.type === 'application') {
    const app = await Application.findById(subject.doc._id).populate('actionedBy', 'name email role').lean();
    const review = await KycReview.findOne({ subjectType: 'application', subjectId: app._id }).lean();
    return (await annotateIdentity([await toQueueItem(app, review)]))[0];
  }
  const customer = await Customer.findById(subject.doc._id).lean();
  const review = await KycReview.findOne({ subjectType: 'account', subjectId: customer._id }).lean();
  return (await annotateIdentity([await customerToQueueItem(customer, review)]))[0];
}

// @desc    Manually decide a KYC case (approve / reject / flag / reopen) with a
//          remark. Recorded as a decision by the signed-in admin.
// @route   PATCH /api/admin/kyc/:id/review
// @access  Private (Admin / Staff only)
export const reviewKycApplication = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const reviewer = reviewerOf(req);
    const remark = notes === undefined ? undefined : String(notes).trim();

    const subject = await loadSubject(id);
    if (!subject) {
      res.status(404);
      return next(new Error('Application not found'));
    }

    const before = subject.type === 'application' ? subject.doc.status : subject.doc.kycStatus || 'pending';
    if (subject.type === 'application' && before === LOCKED_STATUS) {
      res.status(409);
      return next(new Error('This application is already confirmed (payment / appointment completed), so its KYC decision can no longer be changed.'));
    }

    // Changing a decision the system made requires saying why.
    const existing = await KycReview.findOne({ subjectType: subject.type, subjectId: subject.doc._id }).lean();
    if (existing?.decidedBy === 'system' && status !== before && !remark) {
      res.status(400);
      return next(new Error('Add a remark explaining why you are changing the automated decision.'));
    }

    if (subject.type === 'application') {
      const updated = await Application.findOneAndUpdate(
        { _id: subject.doc._id, status: { $ne: LOCKED_STATUS } },
        {
          $set: {
            status,
            ...(remark !== undefined ? { notes: remark } : {}),
            actionedBy: reviewer.id,
            actionedAt: new Date(),
          },
        },
        { returnDocument: 'after', runValidators: true }
      );
      if (!updated) {
        res.status(409);
        return next(new Error('This application was just confirmed and can no longer be changed.'));
      }
    } else {
      await Customer.findByIdAndUpdate(subject.doc._id, {
        $set: {
          kycStatus: status,
          ...(remark !== undefined ? { kycNotes: remark } : {}),
          kycActionedAt: new Date(),
        },
      });
    }

    const now = new Date();
    await KycReview.findOneAndUpdate(
      { subjectType: subject.type, subjectId: subject.doc._id },
      {
        $set: { decidedBy: 'admin', decidedByName: reviewer.name, decidedById: reviewer.id, decidedAt: now },
        $push: {
          history: {
            at: now, actor: 'admin', actorName: reviewer.name, actorId: reviewer.id, kind: 'manual',
            fromStatus: before, toStatus: status, remark: remark || '',
          },
        },
      },
      { upsert: true }
    );

    await audit({
      req,
      action: 'STATUS_UPDATE',
      module: 'KYC',
      targetId: subject.type === 'application' ? subject.doc.referenceNumber || id : subject.doc._id,
      description: before === status
        ? `Confirmed KYC decision (${status})`
        : `Changed KYC status from ${before} to ${status}`,
      metadata: {
        previousStatus: before,
        newStatus: status,
        remark: remark || '',
        overrodeAutomatedDecision: existing?.decidedBy === 'system',
      },
    });

    res.status(200).json({ success: true, application: await itemFor(subject) });
  } catch (error) {
    next(error);
  }
};

// @desc    Run the automated check again for one case (the admin asked for it)
// @route   POST /api/admin/kyc/:id/auto-review
// @access  Private (Admin / Staff only)
export const rerunKycAutoReview = async (req, res, next) => {
  try {
    const subject = await loadSubject(req.params.id);
    if (!subject) {
      res.status(404);
      return next(new Error('Case not found'));
    }
    if (subject.type === 'application' && subject.doc.status === LOCKED_STATUS) {
      res.status(409);
      return next(new Error('This application is already confirmed, so its KYC decision can no longer be changed.'));
    }

    const options = { kind: 'rerun', requestedBy: reviewerOf(req).name };
    const result = subject.type === 'application'
      ? await reviewApplicationAuto(subject.doc, options)
      : await reviewAccountAuto(subject.doc, options);

    res.status(200).json({ success: true, applied: result.applied, decision: result.decision, application: await itemFor(subject) });
  } catch (error) {
    next(error);
  }
};

// @desc    Automatically review every case that is waiting and has not been checked yet
// @route   POST /api/admin/kyc/auto-review
// @access  Private (Admin / Staff only)
export const sweepKycAutoReview = async (req, res, next) => {
  try {
    const summary = await runKycAutoReview({ limit: 50 });
    res.status(200).json({ success: true, summary });
  } catch (error) {
    next(error);
  }
};

// @desc    Re-check every open (pending / flagged) case with the current rules.
//          Runs in the background; poll GET /api/admin/kyc/recheck-all for progress.
//          Cases whose current decision a person made are skipped.
// @route   POST /api/admin/kyc/recheck-all
// @access  Private (Admin / Staff only)
export const recheckAllKyc = async (req, res, next) => {
  try {
    const reviewer = reviewerOf(req);
    const { job, started } = await startRecheckAll({ requestedBy: reviewer.name });
    if (started) {
      await audit({
        req,
        action: 'STATUS_UPDATE',
        module: 'KYC',
        targetId: 'ALL_OPEN_CASES',
        description: `Started re-check of all open KYC cases (${job.total} case${job.total === 1 ? '' : 's'})`,
        metadata: { total: job.total, skippedByPerson: job.skippedByPerson },
      });
    }
    res.status(started ? 202 : 200).json({ success: true, started, job });
  } catch (error) {
    next(error);
  }
};

// @desc    Progress of the latest "re-check all" run (null when none has run)
// @route   GET /api/admin/kyc/recheck-all
// @access  Private (Admin / Staff only)
export const getRecheckAllStatus = (req, res) => {
  res.status(200).json({ success: true, job: getRecheckJob() });
};
