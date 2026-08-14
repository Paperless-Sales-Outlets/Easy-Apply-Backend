import Application from '../../models/admin/applicationModel.js';
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

async function toQueueItem(app) {
  const fd = app.formData || {};
  const docs = fd.documents && typeof fd.documents === 'object' ? fd.documents : {};

  const documents = [];
  for (const { key, label } of DOC_KEYS) {
    const raw = docs[key] ?? fd[key];
    const url = typeof raw === 'string' ? raw : raw?.url;
    if (typeof url === 'string' && url) {
      documents.push({ key, label, url: await getSignedFileUrl(url) });
    }
  }

  return {
    id: app._id,
    referenceNumber: app.referenceNumber,
    name: pick(fd, NAME_FIELDS) || 'Unknown',
    nic: app.nic,
    phone: app.phone,
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
