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
  { key: 'passportDoc',     label: 'Passport' },
  { key: 'nicFront',        label: 'NIC Front' },
  { key: 'nicBack',         label: 'NIC Back' },
  { key: 'brcDoc',          label: 'Business Registration' },
  { key: 'vatDoc',          label: 'VAT Certificate' },
  { key: 'taxExemptionDoc', label: 'Tax Exemption Certificate' },
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
  const url = typeof raw === 'string' ? raw : raw?.url || raw?.id || raw?.fileId;
  if (!url || typeof url !== 'string') return null;

  // GridFS reference uri: gridfs://<objectId>
  if (url.startsWith('gridfs://')) {
    return `/api/files/${url.replace('gridfs://', '')}`;
  }

  // Raw MongoDB 24-character ObjectId
  if (/^[0-9a-fA-F]{24}$/.test(url)) {
    return `/api/files/${url}`;
  }

  // Base64 Data URL (e.g. data:image/jpeg;base64,...)
  if (url.startsWith('data:image/')) {
    return url;
  }

  // Standard absolute HTTP/HTTPS URL
  if (/^https?:\/\//.test(url) || url.startsWith('/api/files/')) {
    return url;
  }

  // Local uploads or S3 path
  return await getSignedFileUrl(url);
};

async function toQueueItem(app) {
  const fd = app.formData || {};
  const docs = fd.documents && typeof fd.documents === 'object' ? fd.documents : {};

  // Find linked customer profile if identity photos were captured at registration
  let userProfile = null;
  if (!docs.nicFront && !fd.nicFront) {
    try {
      userProfile = await User.findOne({
        $or: [
          ...(app.nic ? [{ NIC: app.nic.toUpperCase() }] : []),
          ...(app.phone ? [{ phone: app.phone }] : []),
        ],
      }).lean();
    } catch (_) {}
  }

  const documents = [];
  for (const { key, label } of DOC_KEYS) {
    let raw = docs[key] ?? fd[key];

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

// @desc    Get the KYC review queue (applications awaiting identity review)
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

    res.status(200).json({ success: true, count: queue.length, queue });
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

    if (!application) {
      res.status(404);
      return next(new Error('Application not found'));
    }

    res.status(200).json({ success: true, application: await toQueueItem(application) });
  } catch (error) {
    next(error);
  }
};
