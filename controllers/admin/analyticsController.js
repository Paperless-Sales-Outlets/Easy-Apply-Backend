import Application from '../../models/admin/applicationModel.js';

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

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// @desc    Analytics data: submissions by service type, daily trend (30 days), status breakdown
// @route   GET /api/admin/analytics
// @access  Private (Admin / Staff only)
export const getAnalytics = async (req, res, next) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const [byServiceType, dailySubmissions, statusBreakdown] = await Promise.all([
      // Submissions by service type
      Application.aggregate([
        { $group: { _id: '$serviceType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Submissions by day for last 30 days
      Application.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // Status breakdown (pie chart)
      Application.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    // Fill in missing days in the 30-day range
    const dailyMap = {};
    dailySubmissions.forEach((row) => {
      dailyMap[row._id] = row.count;
    });

    const dailyTrend = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayLabel = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      dailyTrend.push({
        date: dateStr,
        day: dayLabel,
        count: dailyMap[dateStr] || 0,
      });
    }

    // Map service type IDs to labels
    const serviceTypeData = byServiceType.map((row) => ({
      service: SERVICE_LABELS[row._id] || row._id,
      count: row.count,
    }));

    // Map status IDs to labels
    const STATUS_LABELS = {
      pending: 'Pending',
      'pending payment': 'Pending Payment',
      approved: 'Approved',
      confirmed: 'Confirmed',
      rejected: 'Rejected',
      flagged: 'Flagged',
    };

    const statusData = statusBreakdown.map((row) => ({
      status: STATUS_LABELS[row._id] || row._id,
      count: row.count,
    }));

    res.status(200).json({
      success: true,
      byServiceType: serviceTypeData,
      dailyTrend,
      statusBreakdown: statusData,
    });
  } catch (error) {
    next(error);
  }
};
