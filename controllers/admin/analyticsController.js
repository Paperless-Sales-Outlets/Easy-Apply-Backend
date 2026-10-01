import Application from '../../models/admin/applicationModel.js';
import User from '../../models/User.js';

const SERVICE_LABELS = {
  'new-connection': 'New Connection',
  'reconnection': 'Reconnection',
  'relocation': 'Relocation',
  'termination': 'Termination',
  'transfer': 'Transfer',
  'package-migration': 'Package Migration',
  'service-vacation': 'Service Vacation',
  'refund-request': 'Refund Request',
  'customer-request-acceptance': 'Customer Request Acceptance',
  'internet-services': 'Internet Services',
};

const STATUS_LABELS = {
  pending: 'Pending',
  'pending payment': 'Pending Payment',
  approved: 'Approved',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  flagged: 'Flagged',
};

const CLOSED_STATUSES = ['approved', 'confirmed'];
const OPEN_STATUSES = ['pending', 'pending payment'];

const MAX_RANGE_DAYS = 366;

// Whole UTC days covered by the window, both ends inclusive.
const countDays = (from, to) => {
  const fromDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((toDay - fromDay) / 86400000) + 1;
};

// Resolves the `from` / `to` window shared by every report on this page.
// Defaults to the last 30 days, and is clamped so a stray year typo cannot
// ask the database for an unbounded aggregation.
//
// Days are treated as UTC days end-to-end: the range boundaries, the Mongo
// `$dateToString` buckets and the zero-filled trend below all use the same
// frame, so a day's bucket can never disagree with the filter that produced it.
const resolveRange = (query = {}) => {
  const parsedTo = query.to ? new Date(query.to) : new Date();
  const parsedFrom = query.from ? new Date(query.from) : null;

  const to = Number.isNaN(parsedTo.getTime()) ? new Date() : parsedTo;
  let from = parsedFrom && !Number.isNaN(parsedFrom.getTime()) ? parsedFrom : null;

  if (!from) {
    from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 29);
  }
  if (from > to) {
    const swap = from.getTime();
    from = new Date(to);
    to.setTime(swap);
  }

  if (Math.ceil((to - from) / 86400000) > MAX_RANGE_DAYS) {
    from = new Date(to);
    from.setUTCDate(from.getUTCDate() - MAX_RANGE_DAYS);
  }

  from.setUTCHours(0, 0, 0, 0);
  to.setUTCHours(23, 59, 59, 999);

  return { from, to, days: countDays(from, to) };
};

const buildFilter = (query, { requireActioned = false } = {}) => {
  const { from, to, days } = resolveRange(query);
  const match = { createdAt: { $gte: from, $lte: to } };

  if (query.serviceType && query.serviceType !== 'all') {
    match.serviceType = query.serviceType;
  }
  if (query.status && query.status !== 'all') {
    match.status = query.status;
  }
  if (requireActioned) {
    match.actionedBy = { $ne: null };
  }

  return { match, from, to, days };
};

const labelFor = (map, key) => map[key] || key;

// formData is schemaless, so each field below may live under a different key
// depending on which service form captured it. First non-empty value wins.
const pick = (source, keys) => {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
};

const productPriceOf = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
};

const PRODUCT_NAME_KEYS = [
  'selectedProduct',
  'productName',
  'packageName',
  'broadbandPackage',
  'requiredPackage',
  'requestedPackage',
  'bundle',
  'plan',
  'product',
];

const PRODUCT_PRICE_KEYS = ['monthlyPrice', 'price', 'amount', 'total'];

// `formData.product` is sometimes a nested object and sometimes a plain string,
// so both shapes are flattened before picking a name and a price.
const resolveProduct = (fd) => {
  const raw = pick(fd, PRODUCT_NAME_KEYS);
  const nested = raw && typeof raw === 'object' ? raw : null;
  const nestedName = nested ? pick(nested, PRODUCT_NAME_KEYS) : '';

  const name = (typeof nestedName === 'string' ? nestedName : '').trim()
    || (typeof raw === 'string' ? raw.trim() : '');

  const price = productPriceOf(
    pick(nested || {}, PRODUCT_PRICE_KEYS) ?? pick(fd, PRODUCT_PRICE_KEYS)
  );

  return { name: name || '—', price };
};

// @desc    Analytics data: submissions by service type, daily trend, status breakdown
// @route   GET /api/admin/analytics?from=&to=&serviceType=&status=
// @access  Private (Admin / Staff only)
export const getAnalytics = async (req, res, next) => {
  try {
    const { match, from, to, days } = buildFilter(req.query);

    const [byServiceType, dailySubmissions, statusBreakdown] = await Promise.all([
      Application.aggregate([
        { $match: match },
        { $group: { _id: '$serviceType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Application.aggregate([
        { $match: match },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      Application.aggregate([
        { $match: match },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    // Zero-fill so a quiet day still renders a point on the trend line.
    const dailyMap = {};
    dailySubmissions.forEach((row) => {
      dailyMap[row._id] = row.count;
    });

    const dailyTrend = [];
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    for (let i = 0; i < days; i++) {
      const dateStr = cursor.toISOString().slice(0, 10);
      dailyTrend.push({
        date: dateStr,
        day: cursor.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          timeZone: 'UTC',
        }),
        count: dailyMap[dateStr] || 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    res.status(200).json({
      success: true,
      // Map service type IDs to labels
      range: { from: from.toISOString(), to: to.toISOString(), days },
      byServiceType: byServiceType.map((row) => ({
        service: labelFor(SERVICE_LABELS, row._id),
        count: row.count,
      })),
      dailyTrend,
      statusBreakdown: statusBreakdown.map((row) => ({
        status: labelFor(STATUS_LABELS, row._id),
        count: row.count,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Application-level report rows: product, customer, NIC, mobile, amount, dates
// @route   GET /api/admin/analytics/reports/applications
// @access  Private (Admin / Staff only)
export const getApplicationReports = async (req, res, next) => {
  try {
    const { match, from, to, days } = buildFilter(req.query);
    const search = (req.query.search || '').trim();

    const query = { ...match };
    if (search) {
      // Reference numbers are stored as plain text, but the customer fields the
      // operator searches for live in the schemaless formData blob.
      query.$or = [
        { referenceNumber: { $regex: search, $options: 'i' } },
        { nic: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { 'formData.nameFull': { $regex: search, $options: 'i' } },
        { 'formData.fullName': { $regex: search, $options: 'i' } },
        { 'formData.customerName': { $regex: search, $options: 'i' } },
        { 'formData.product.name': { $regex: search, $options: 'i' } },
      ];
    }

    const CAP = 2000;
    const applications = await Application.find(query)
      .sort({ createdAt: -1 })
      .limit(CAP)
      .lean();

    const rows = applications.map((app) => {
      const fd = app.formData || {};
      const product = resolveProduct(fd);
      const paidAmount =
        productPriceOf(app.officeFields?.amountPaid) ??
        productPriceOf(app.paymentDetails?.amount) ??
        product.price;

      return {
        id: app._id,
        product: product.name,
        customerName:
          pick(fd, ['nameFull', 'fullName', 'contactName', 'customerName', 'legalOwner']) || '—',
        nic: app.nic || pick(fd, ['nic', 'NIC']) || '—',
        mobile: app.phone || pick(fd, ['mobileNumber', 'contactNumber']) || '—',
        paidAmount,
        paymentStatus: app.paymentStatus || 'pending',
        applyDate: app.createdAt,
        referenceNumber: app.referenceNumber,
        serviceType: app.serviceType,
        serviceLabel: labelFor(SERVICE_LABELS, app.serviceType),
        status: app.status || 'pending',
        statusLabel: labelFor(STATUS_LABELS, app.status || 'pending'),
      };
    });

    const collected = rows.reduce(
      (sum, row) => sum + (row.paidAmount || 0),
      0
    );

    res.status(200).json({
      success: true,
      range: { from: from.toISOString(), to: to.toISOString(), days },
      summary: {
        totalApplications: rows.length,
        totalCollected: Number(collected.toFixed(2)),
        paidCount: rows.filter((r) => r.paymentStatus === 'paid').length,
        truncated: rows.length === CAP,
      },
      rows,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Per-user progress report: tasks handled by each admin/staff member
// @route   GET /api/admin/analytics/reports?from=&to=&serviceType=&status=&role=&search=
// @access  Private (Admin / Staff only)
export const getUserReports = async (req, res, next) => {
  try {
    const { match, from, to, days } = buildFilter(req.query, { requireActioned: true });
    const role = req.query.role && req.query.role !== 'all' ? req.query.role : null;
    const search = (req.query.search || '').trim().toLowerCase();

    // Every account in `users` is admin/staff; customers live in `customers`.
    const userQuery = role ? { role } : {};
    if (search) {
      userQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { NIC: { $regex: search, $options: 'i' } },
      ];
    }

    const [users, taskRows, serviceRows] = await Promise.all([
      User.find(userQuery)
        .select('name email phone role NIC createdAt')
        .sort({ name: 1 })
        .lean(),

      Application.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$actionedBy',
            total: { $sum: 1 },
            approved: {
              $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] },
            },
            confirmed: {
              $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] },
            },
            rejected: {
              $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] },
            },
            flagged: {
              $sum: { $cond: [{ $eq: ['$status', 'flagged'] }, 1, 0] },
            },
            open: {
              $sum: { $cond: [{ $in: ['$status', OPEN_STATUSES] }, 1, 0] },
            },
            lastActionedAt: { $max: '$actionedAt' },
            handleMs: {
              $sum: {
                $cond: [
                  { $and: [{ $ne: ['$actionedAt', null] }, { $ne: ['$actionedAt', '$createdAt'] }] },
                  { $subtract: ['$actionedAt', '$createdAt'] },
                  0,
                ],
              },
            },
            handledSamples: {
              $sum: { $cond: [{ $ne: ['$actionedAt', null] }, 1, 0] },
            },
          },
        },
      ]),

      Application.aggregate([
        { $match: match },
        {
          $group: {
            _id: { user: '$actionedBy', service: '$serviceType' },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]),
    ]);

    const taskByUser = new Map();
    taskRows.forEach((row) => {
      taskByUser.set(String(row._id), row);
    });

    const servicesByUser = new Map();
    serviceRows.forEach((row) => {
      const key = String(row._id.user);
      if (!servicesByUser.has(key)) servicesByUser.set(key, []);
      servicesByUser.get(key).push({
        service: labelFor(SERVICE_LABELS, row._id.service),
        count: row.count,
      });
    });

    const reports = users.map((user) => {
      const stats = taskByUser.get(String(user._id));
      const total = stats?.total || 0;
      const approved = stats?.approved || 0;
      const confirmed = stats?.confirmed || 0;
      const closed = approved + confirmed;
      const handleSamples = stats?.handledSamples || 0;
      const avgHandleHours = handleSamples
        ? Number(((stats.handleMs / handleSamples) / 3600000).toFixed(1))
        : null;

      return {
        userId: user._id,
        name: user.name,
        email: user.email || '',
        phone: user.phone || '',
        role: user.role,
        joinedAt: user.createdAt,
        total,
        approved,
        confirmed,
        rejected: stats?.rejected || 0,
        flagged: stats?.flagged || 0,
        open: stats?.open || 0,
        closed,
        // Share of the user's handled tasks that reached a final approval.
        completionRate: total ? Math.round((closed / total) * 100) : 0,
        avgHandleHours,
        lastActionedAt: stats?.lastActionedAt || null,
        services: (servicesByUser.get(String(user._id)) || []).slice(0, 4),
      };
    });

    // Busiest first, but staff with no activity in the window stay visible at
    // the bottom — an idle user is exactly what a progress report should surface.
    reports.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    const activeUsers = reports.filter((r) => r.total > 0);
    const totalTasks = reports.reduce((s, r) => s + r.total, 0);
    const totalClosed = reports.reduce((s, r) => s + r.closed, 0);

    res.status(200).json({
      success: true,
      range: { from: from.toISOString(), to: to.toISOString(), days },
      summary: {
        totalUsers: reports.length,
        activeUsers: activeUsers.length,
        idleUsers: reports.length - activeUsers.length,
        totalTasks,
        avgTasksPerUser: activeUsers.length
          ? Number((totalTasks / activeUsers.length).toFixed(1))
          : 0,
        completionRate: totalTasks ? Math.round((totalClosed / totalTasks) * 100) : 0,
      },
      reports,
    });
  } catch (error) {
    next(error);
  }
};
