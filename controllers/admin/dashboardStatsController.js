import Application from '../../models/admin/applicationModel.js';
import { query, toCamelCase } from '../../config/db.js';
import { buildWhereClause } from '../../db/modelHelper.js';
import { pickFrom } from '../../db/jsonSelect.js';

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

const countByServiceType = async (filter) => {
  const { whereText, values } = buildWhereClause(filter);
  const { rows } = await query(
    `SELECT service_type AS "_id", COUNT(*)::int AS count FROM applications ${whereText} GROUP BY service_type`,
    values
  );
  return rows;
};

// Only the form fields normalizeApplication reads, without the customer's images.
const RECENT_FORM_KEYS = [
  'address', 'fullAddress', 'residentialAddress', 'serviceAddress', 'permanentAddress', 'billingAddress',
  'addressLine1', 'addressLine2',
  'nameFull', 'fullName', 'contactName', 'customerName', 'legalOwner', 'currentCustomerName', 'applicantName',
  'nic', 'NIC', 'email', 'emailAddress',
];

const latestApplications = async (limit) => {
  const { rows } = await query(
    `SELECT id, reference_number, nic, phone, service_type, status, notes, actioned_by, actioned_at, created_at,
       ${pickFrom('form_data', RECENT_FORM_KEYS, 'f', (v) => v)} AS form_data
     FROM applications ORDER BY created_at DESC LIMIT ${limit}`
  );
  return rows.map((row) => toCamelCase(row));
};

// @desc    Operations dashboard statistics
// @route   GET /api/admin/dashboard-stats
// @access  Private (Admin / Staff only)
export const getDashboardStats = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Optional submission-date range. When supplied (by the Forms page summary
    // cards) the per-service-type totals and completions are scoped to the
    // window; without it the figures stay all-time.
    const rangeMatch = {};
    if (startDate) rangeMatch.$gte = new Date(startDate);
    if (endDate) rangeMatch.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    const hasRange = Object.keys(rangeMatch).length > 0;
    const range = hasRange ? { createdAt: rangeMatch } : {};

    const [statusRows, totalsByType, completedByType, recent] = await Promise.all([
      // Count per status
      Application.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),

      // Total submissions per service type
      countByServiceType(range),

      // Completed submissions per service type
      countByServiceType({ ...range, status: { $in: COMPLETED_STATUSES } }),

      // Latest applications for the recent history table
      latestApplications(15),
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
      range: hasRange ? { startDate: startDate || null, endDate: endDate || null } : null,
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
