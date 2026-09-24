import Application from '../../models/admin/applicationModel.js';
import User from '../../models/User.js';
import { getSignedFileUrl } from '../../services/s3Service.js';

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
  { key: 'customerSignature', label: 'Customer Signature' },
  { key: 'brcDoc',            label: 'Business Registration' },
  { key: 'vatDoc',            label: 'VAT Certificate' },
  { key: 'taxExemptionDoc',   label: 'Tax Exemption Certificate' },
];

const REVIEW_STATUSES = ['pending', 'pending payment', 'flagged'];

function pick(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

const resolveDocUrl = async (raw) => {
  if (!raw) return null;
  // ObjectId instances (copied from User.identityDocuments) stringify to 24-hex
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
async function userToQueueItem(user) {
  const documents = [];
  for (const { key, label } of USER_DOC_KEYS) {
    const url = await resolveDocUrl(user.identityDocuments?.[key]);
    if (url) documents.push({ key, label, url });
  }
  return {
    id: user._id,
    kind: 'account',
    referenceNumber: 'ACCOUNT',
    name: user.name,
    nic: user.NIC,
    phone: user.phone,
    serviceType: 'account-registration',
    status: user.kycStatus || 'pending',
    submittedAt: user.identityDocuments?.capturedAt || user.createdAt,
    updatedAt: user.updatedAt,
    notes: user.kycNotes || '',
    actionedAt: user.kycActionedAt || null,
    actionedBy: null,
    documents,
  };
}

async function toQueueItem(app) {
  const fd = app.formData || {};
  const docs = fd.documents && typeof fd.documents === 'object' ? fd.documents : {};

  // Linked customer profile — holds the NIC + live face photo captured at registration
  let userProfile = null;
  try {
    const last9 = String(app.phone || '').replace(/\D/g, '').slice(-9);
    userProfile = await User.findOne({
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

    // Fallback to User identityDocuments (captured during sign-up / OCR)
    if (!raw && userProfile?.identityDocuments?.[key]) {
      raw = userProfile.identityDocuments[key];
    }

    const resolved = await resolveDocUrl(raw);
    if (resolved) {
      documents.push({ key, label, url: resolved });
    }
  }

  return {
    id: app._id,
    referenceNumber: app.referenceNumber,
    name: pick(fd, NAME_FIELDS) || userProfile?.name || 'Unknown',
    nic: app.nic || userProfile?.NIC,
    phone: app.phone || userProfile?.phone,
    serviceType: app.serviceType,
    status: app.status,
    submittedAt: app.createdAt,
    updatedAt: app.updatedAt,
    notes: app.notes || '',
    actionedAt: app.actionedAt || null,
    actionedBy: app.actionedBy
      ? { name: app.actionedBy.name, email: app.actionedBy.email, role: app.actionedBy.role }
      : null,
    documents,
  };
}

// @desc    Get the KYC review queue: applications awaiting review, plus registered
//          customers whose NIC / live photo hasn't been tied to an application yet
// @route   GET /api/admin/kyc
// @access  Private (Admin / Staff only)
export const getKycQueue = async (req, res, next) => {
  try {
    const applications = await Application
      .find({ status: { $in: REVIEW_STATUSES } })
      .populate('actionedBy', 'name email role')
      .sort({ createdAt: 1 })
      .lean();

    const queue = await Promise.all(applications.map(toQueueItem));

    // Registered customers with captured ID images and no application yet — once they
    // apply, the application (in any status) carries the decision
    const covered = new Set((await Application.distinct('nic')).map((n) => String(n).toUpperCase()));
    const users = await User
      .find({
        'identityDocuments.nicFront': { $exists: true },
        $or: [{ kycStatus: { $exists: false } }, { kycStatus: { $in: REVIEW_STATUSES } }],
      })
      .sort({ 'identityDocuments.capturedAt': 1 })
      .lean();
    const accounts = await Promise.all(
      users.filter((u) => !covered.has(String(u.NIC).toUpperCase())).map(userToQueueItem)
    );

    const all = [...queue, ...accounts];
    res.status(200).json({ success: true, count: all.length, queue: all });
  } catch (error) {
    next(error);
  }
};

// @desc    Review a KYC case (approve / reject / flag / reopen) with staff notes
// @route   PATCH /api/admin/kyc/:id/review
// @access  Private (Admin / Staff only)
export const reviewKycApplication = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const updates = { status };
    if (notes !== undefined) updates.notes = notes;
    if (req.user && req.user._id) {
      updates.actionedBy = req.user._id;
      updates.actionedAt = new Date();
    }

    const application = await Application.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    )
      .populate('actionedBy', 'name email role')
      .lean();

    if (application) {
      return res.status(200).json({ success: true, application: await toQueueItem(application) });
    }

    // Not an application id — a registered customer's account-level KYC
    const user = await User.findByIdAndUpdate(
      id,
      {
        $set: {
          kycStatus: status,
          ...(notes !== undefined ? { kycNotes: notes } : {}),
          kycActionedAt: new Date(),
        },
      },
      { new: true }
    ).lean();

    if (!user) {
      res.status(404);
      return next(new Error('Application not found'));
    }

    res.status(200).json({ success: true, application: await userToQueueItem(user) });
  } catch (error) {
    next(error);
  }
};
