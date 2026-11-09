import AuditLog from '../../models/AuditLog.js';
import User from '../../models/User.js';
import { escapeRegex } from '../../utils/employeeNumber.js';

const positiveInt = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

// Module, description, target and user name live in the `details` JSON column.
const presentLog = (log, names) => ({
  ...log,
  timestamp: log.createdAt,
  userName: log.details?.userName || names.get(log.actorId) || null,
  module: log.details?.module || null,
  targetId: log.details?.targetId || null,
  description: log.details?.description || null,
  metadata: log.details?.metadata || null,
});

// Entries written before the details were stored only have the actor's id.
const staffNames = async (logs) => {
  const ids = [...new Set(logs.filter((log) => !log.details?.userName && log.actorId).map((log) => log.actorId))];
  if (!ids.length) return new Map();
  const users = await User.find({ _id: { $in: ids } }).select('_id name').lean();
  return new Map(users.map((user) => [user.id, user.name]));
};

/**
 * @desc    List audit logs with pagination and search/action/module/date filters
 * @route   GET /api/admin/audit
 * @access  Private (Admin)
 */
export const getAuditLogs = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 25,
      search,
      action,
      module,
      from,
      to,
      startDate,
      endDate,
    } = req.query;
    const pageNumber = positiveInt(page, 1, 1000000);
    const pageSize = positiveInt(limit, 25, 100);
    const filter = {};

    if (action) filter.action = String(action).trim().toUpperCase();
    if (module) filter['details.module'] = { $regex: escapeRegex(String(module).trim()), $options: 'i' };
    if (search) {
      const expression = { $regex: escapeRegex(String(search).trim()), $options: 'i' };
      filter.$or = [
        { action: expression },
        { 'details.module': expression },
        { 'details.targetId': expression },
        { 'details.description': expression },
        { 'details.userName': expression },
      ];
    }

    const lowerDate = from || startDate;
    const upperDate = to || endDate;
    if (lowerDate || upperDate) {
      filter.createdAt = {};
      if (lowerDate) {
        const date = new Date(lowerDate);
        if (Number.isNaN(date.getTime())) return res.status(400).json({ success: false, message: 'Invalid from date' });
        filter.createdAt.$gte = date;
      }
      if (upperDate) {
        const date = new Date(upperDate);
        if (Number.isNaN(date.getTime())) return res.status(400).json({ success: false, message: 'Invalid to date' });
        date.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = date;
      }
    }

    const skip = (pageNumber - 1) * pageSize;
    const [rows, totalCount] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
      AuditLog.countDocuments(filter),
    ]);
    const names = await staffNames(rows);
    const logs = rows.map((row) => presentLog(row, names));

    res.status(200).json({
      success: true,
      logs,
      auditLogs: logs,
      pagination: {
        currentPage: pageNumber,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (error) {
    next(error);
  }
};
