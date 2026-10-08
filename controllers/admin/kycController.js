import mongoose from 'mongoose';
import Application from '../../models/admin/applicationModel.js';
import Customer from '../../models/Customer.js';
import KycReview from '../../models/admin/kycReviewModel.js';
import { getSignedFileUrl } from '../../services/s3Service.js';
import {
  reviewApplicationAuto,
  reviewAccountAuto,
  runKycAutoReview,
} from '../../services/kycAutoReviewService.js';
import { recordAudit } from '../../services/auditService.js';

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

const USER_DOC_KEYS = DOC_KEYS.filter(({ key }) => ['nicFront', 'nicBack', 'facePhoto'].includes(key));

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
    };
  }
  return {
    decidedBy: review.decidedBy || legacy?.by || null,
    decidedByName: review.decidedBy ? review.decidedByName : legacy?.name || '',
    decidedAt: review.decidedBy ? review.decidedAt : legacy?.at || null,
    autoDecision: review.autoDecision || null,
    autoCheckedAt: review.autoCheckedAt || null,
    checks: (review.checks || []).map((c) => ({ key: c.key, label: c.label, result: c.result, detail: c.detail })),
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
  for (const { key, label } of USER_DOC_KEYS) {
    const url = await resolveDocUrl(customer.identityDocuments?.[key]);
    if (url) documents.push({ key, label, url });
  }
  return {
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

async function toQueueItem(app, review) {
  const fd = app.formData || {};
  const docs = fd.documents && typeof fd.documents === 'object' ? fd.documents : {};

  // Linked customer profile — holds the NIC + live face photo captured at registration
  let customerProfile = null;
  try {
    const last9 = String(app.phone || '').replace(/\D/g, '').slice(-9);
    customerProfile = await Customer.findOne({
      $or: [
        ...(app.nic ? [{ NIC: app.nic.toUpperCase() }] : []),
        ...(last9 ? [{ phone: new RegExp(`${last9}$`) }] : []),
      ],
    }).lean();
  } catch (_) {}

  const documents = [];
  for (const { key, label } of DOC_KEYS) {
    let raw = docs[key] ?? fd[key];

    // Fallback for signature from root form data
    if (key === 'signature' && !raw) raw = fd.signature;

    // Fallback to Customer identityDocuments (captured during sign-up / OCR)
    if (!raw && customerProfile?.identityDocuments?.[key]) {
      raw = customerProfile.identityDocuments[key];
    }

    const resolved = await resolveDocUrl(raw);
    if (resolved) {
      documents.push({ key, label, url: resolved });
    }
  }

  return {
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
      Application
        .find({ status: { $in: REVIEW_STATUSES } })
        .populate('actionedBy', 'name email role')
        .sort({ createdAt: 1 })
        .lean(),
      Application
        .find({
          status: { $in: ['approved', 'rejected', LOCKED_STATUS] },
          $or: [{ _id: { $in: reviewedAppIds } }, { actionedBy: { $ne: null } }],
        })
        .populate('actionedBy', 'name email role')
        .sort({ updatedAt: -1 })
        .limit(DECIDED_LIMIT)
        .lean(),
    ]);

    const applications = [...open, ...decided];
    const appReviews = await reviewsFor('application', applications.map((a) => a._id));
    const queue = await Promise.all(applications.map((a) => toQueueItem(a, appReviews.get(String(a._id)))));

    // Registered customers with captured ID images and no application yet — once they
    // apply, the application (in any status) carries the decision
    const covered = new Set((await Application.distinct('nic')).map((n) => String(n).toUpperCase()));
    const reviewedAccountIds = await KycReview.find({ subjectType: 'account' }).distinct('subjectId');
    const customers = await Customer
      .find({
        'identityDocuments.nicFront': { $exists: true },
        $or: [
          { kycStatus: { $exists: false } },
          { kycStatus: { $in: REVIEW_STATUSES } },
          { kycStatus: { $in: ['approved', 'rejected'] }, _id: { $in: reviewedAccountIds } },
          { kycStatus: { $in: ['approved', 'rejected'] }, kycActionedAt: { $ne: null } },
        ],
      })
      .sort({ 'identityDocuments.capturedAt': 1 })
      .limit(DECIDED_LIMIT * 2)
      .lean();
    const accountCustomers = customers.filter((u) => !covered.has(String(u.NIC).toUpperCase()));
    const accountReviews = await reviewsFor('account', accountCustomers.map((c) => c._id));
    const accounts = await Promise.all(accountCustomers.map((c) => customerToQueueItem(c, accountReviews.get(String(c._id)))));

    const all = [...queue, ...accounts];
    res.status(200).json({ success: true, count: all.length, queue: all });
  } catch (error) {
    next(error);
  }
};

async function loadSubject(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const application = await Application.findById(id);
  if (application) return { type: 'application', doc: application };
  const customer = await Customer.findById(id);
  return customer ? { type: 'account', doc: customer } : null;
}

async function itemFor(subject) {
  if (subject.type === 'application') {
    const app = await Application.findById(subject.doc._id).populate('actionedBy', 'name email role').lean();
    const review = await KycReview.findOne({ subjectType: 'application', subjectId: app._id }).lean();
    return toQueueItem(app, review);
  }
  const customer = await Customer.findById(subject.doc._id).lean();
  const review = await KycReview.findOne({ subjectType: 'account', subjectId: customer._id }).lean();
  return customerToQueueItem(customer, review);
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
        { new: true, runValidators: true }
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
