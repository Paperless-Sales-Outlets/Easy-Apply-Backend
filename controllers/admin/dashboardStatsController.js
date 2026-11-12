import Application from '../../models/admin/applicationModel.js';
import { query, toCamelCase } from '../../config/db.js';
import { buildWhereClause } from '../../db/modelHelper.js';
import { pickFrom } from '../../db/jsonSelect.js';
import { sriLankaDay, sriLankaDayRange, startOfSriLankaDay } from '../../utils/sriLankaDate.js';

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

const latestApplications = async (limit, whereSql = '', values = []) => {
  const { rows } = await query(
    `SELECT id, reference_number, nic, phone, service_type, status, notes, actioned_by, actioned_at, created_at,
       ${pickFrom('form_data', RECENT_FORM_KEYS, 'f', (v) => v)} AS form_data
     FROM applications ${whereSql} ORDER BY created_at DESC LIMIT ${limit}`,
    values
  );
  return rows.map((row) => toCamelCase(row));
};

// ── Admin Dashboard figures (?include=dashboard) ─────────────────────────────
// The Dashboard used to work these out in the browser from the newest page of
// applications, so they went wrong once there were more. They are counted over
// every application here instead, on Sri Lanka days, with the same rules the
// Dashboard applied: approved/rejected are dated by when they were actioned.

const PENDING_STATUSES = ['pending', 'pending payment'];
const TREND_DAYS = 7;
const PENDING_LIST_CAP = 500;
const DAY_MS = 86400000;
const DECIDED_ON = 'COALESCE(actioned_at, updated_at)';
const slDay = (column) => `to_char(${column} AT TIME ZONE 'Asia/Colombo', 'YYYY-MM-DD')`;

async function dashboardFigures(statusCounts) {
  const today = sriLankaDay();
  const days = Array.from({ length: TREND_DAYS }, (_, i) =>
    new Date(Date.parse(today) - (TREND_DAYS - 1 - i) * DAY_MS).toISOString().slice(0, 10));
  const since = startOfSriLankaDay(days[0]);
  const startOfToday = startOfSriLankaDay(today);

  const [submittedRows, decidedRows, todayRows, oldestRows, pendingApps] = await Promise.all([
    query(
      `SELECT ${slDay('created_at')} AS day, COUNT(*)::int AS submitted,
         COUNT(*) FILTER (WHERE status = ANY($2))::int AS pending
       FROM applications WHERE created_at >= $1 GROUP BY day`,
      [since, PENDING_STATUSES]
    ),
    query(
      `SELECT ${slDay(DECIDED_ON)} AS day,
         COUNT(*) FILTER (WHERE status = ANY($2))::int AS approved,
         COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
       FROM applications WHERE ${DECIDED_ON} >= $1 GROUP BY day`,
      [since, COMPLETED_STATUSES]
    ),
    query(
      `SELECT service_type AS id,
         COUNT(*) FILTER (WHERE created_at >= $1)::int AS submitted,
         COUNT(*) FILTER (WHERE status = ANY($2) AND ${DECIDED_ON} >= $1)::int AS completed
       FROM applications GROUP BY service_type`,
      [startOfToday, COMPLETED_STATUSES]
    ),
    query(`SELECT MIN(created_at) AS oldest FROM applications WHERE status = ANY($1)`, [PENDING_STATUSES]),
    latestApplications(PENDING_LIST_CAP, 'WHERE status = ANY($1)', [PENDING_STATUSES]),
  ]);

  const byDay = (rows, key) => {
    const map = Object.fromEntries(rows.rows.map((row) => [row.day, row[key]]));
    return days.map((day) => map[day] || 0);
  };
  const trends = {
    todaySubmissions: byDay(submittedRows, 'submitted'),
    pendingKyc: byDay(submittedRows, 'pending'),
    approvedToday: byDay(decidedRows, 'approved'),
    rejectedToday: byDay(decidedRows, 'rejected'),
  };

  // Who left each comment, as the applications list does.
  const actionerIds = [...new Set(pendingApps.map((app) => app.actionedBy).filter(Boolean))];
  const actioners = actionerIds.length
    ? (await query('SELECT id, name, email FROM users WHERE id = ANY($1)', [actionerIds])).rows
    : [];
  const actionerById = new Map(actioners.map((u) => [u.id, { _id: u.id, name: u.name, email: u.email }]));

  return {
    days,
    trends,
    kpis: {
      todaySubmissions: trends.todaySubmissions[TREND_DAYS - 1],
      pendingKyc: PENDING_STATUSES.reduce((sum, status) => sum + (statusCounts[status] || 0), 0),
      approvedToday: trends.approvedToday[TREND_DAYS - 1],
      rejectedToday: trends.rejectedToday[TREND_DAYS - 1],
    },
    todayByServiceType: Object.fromEntries(todayRows.rows.map((row) => [row.id, { submitted: row.submitted, completed: row.completed }])),
    oldestPendingAt: oldestRows.rows[0]?.oldest || null,
    pendingApplications: pendingApps.map((app) => ({
      ...normalizeApplication(app),
      actionedBy: actionerById.get(app.actionedBy) || null,
    })),
    pendingListCapped: pendingApps.length >= PENDING_LIST_CAP,
  };
}

// @desc    Operations dashboard statistics
// @route   GET /api/admin/dashboard-stats
// @access  Private (Admin / Staff only)
export const getDashboardStats = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const startOfToday = startOfSriLankaDay(new Date());

    // Optional submission-date range. When supplied (by the Forms page summary
    // cards) the per-service-type totals and completions are scoped to the
    // window; without it the figures stay all-time.
    const rangeMatch = sriLankaDayRange(startDate, endDate);
    const hasRange = Boolean(rangeMatch);
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
      ...(req.query.include === 'dashboard' ? { dashboard: await dashboardFigures(statusCounts) } : {}),
    });
  } catch (error) {
    next(error);
  }
};
