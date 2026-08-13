import Application from '../../models/admin/applicationModel.js';

// The 9 service form types tracked across the operations dashboard.
const FORM_TYPES = [
  { id: 'new-connection', label: 'New Connection' },
  { id: 'reconnection', label: 'Reconnection' },
  { id: 'relocation', label: 'Relocation' },
  { id: 'termination', label: 'Termination' },
  { id: 'transfer', label: 'Transfer' },
  { id: 'package-migration', label: 'Package Migration' },
  { id: 'service-vacation', label: 'Service Vacation' },
  { id: 'refund-request', label: 'Refund Request' },
  { id: 'customer-request-acceptance', label: 'Customer Request Acceptance' },
];

const COMPLETED_STATUSES = ['approved', 'confirmed'];

// Pick the first non-empty value from a list of candidate keys.
function pick(obj, keys) {
  for (const key of keys) {
    const value = obj && obj[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

// Map a raw Application document to the display shape used by the admin UI.
function normalizeApplication(app) {
  const fd = app.formData || {};
  const address = pick(fd, [
    'address',
    'fullAddress',
    'residentialAddress',
    'serviceAddress',
    'permanentAddress',
    'billingAddress',
  ]) || [fd.addressLine1, fd.addressLine2].filter(Boolean).join(', ');

  return {
    id: app._id,
    referenceNumber: app.referenceNumber,
    name: pick(fd, [
      'nameFull',
      'fullName',
      'contactName',
      'customerName',
      'legalOwner',
      'currentCustomerName',
      'applicantName',
    ]),
    nic: app.nic || pick(fd, ['nic', 'NIC']),
    phone: app.phone || '',
    email: pick(fd, ['email', 'emailAddress']),
    serviceType: app.serviceType,
    status: app.status || 'pending',
    submittedAt: app.createdAt || app.submittedAt,
    address,
    notes: app.notes || '',
    actionedBy: app.actionedBy || null,
    actionedAt: app.actionedAt || null,
  };
}

// @desc    Operations dashboard statistics
// @route   GET /api/admin/dashboard-stats
// @access  Private (Admin / Staff only)
export const getDashboardStats = async (req, res, next) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [statusRows, totalsByType, completedByType, recent] = await Promise.all([
      // Count per status
      Application.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),

      // Total submissions per service type
      Application.aggregate([{ $group: { _id: '$serviceType', count: { $sum: 1 } } }]),

      // Completed submissions per service type
      Application.aggregate([
        { $match: { status: { $in: COMPLETED_STATUSES } } },
        { $group: { _id: '$serviceType', count: { $sum: 1 } } },
      ]),

      // Latest applications for the recent history table
      Application.find()
        .populate('actionedBy', 'name email')
        .sort({ createdAt: -1 })
        .limit(15)
        .lean(),
    ]);

    const statusCounts = { pending: 0, 'pending payment': 0, approved: 0, confirmed: 0, rejected: 0, flagged: 0 };
    statusRows.forEach((row) => {
      if (row._id in statusCounts) statusCounts[row._id] = row.count;
    });

    const pendingKyc = statusCounts.pending;
    const todaySubmissions = await Application.countDocuments({ createdAt: { $gte: startOfToday } });
    const [approvedToday, rejectedToday] = await Promise.all([
      Application.countDocuments({
        status: { $in: COMPLETED_STATUSES },
        updatedAt: { $gte: startOfToday },
      }),
      Application.countDocuments({
        status: 'rejected',
        updatedAt: { $gte: startOfToday },
      }),
    ]);

    const totalsByTypeMap = Object.fromEntries(totalsByType.map((row) => [row._id, row.count]));
    const completedByTypeMap = Object.fromEntries(completedByType.map((row) => [row._id, row.count]));

    const byServiceType = FORM_TYPES.map((form) => ({
      id: form.id,
      label: form.label,
      total: totalsByTypeMap[form.id] || 0,
      completed: completedByTypeMap[form.id] || 0,
    }));

    res.status(200).json({
      success: true,
      pendingKyc,
      approvedToday,
      rejectedToday,
      todaySubmissions,
      byServiceType,
      statusCounts,
      recentApplications: recent.map(normalizeApplication),
    });
  } catch (error) {
    next(error);
  }
};
