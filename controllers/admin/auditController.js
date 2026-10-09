import AuditLog from '../../models/AuditLog.js';

const positiveInt = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

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
    if (module) filter.module = { $regex: String(module).trim(), $options: 'i' };
    if (search) {
      const expression = { $regex: String(search).trim(), $options: 'i' };
      filter.$or = [
        { action: expression },
        { module: expression },
        { targetId: expression },
        { description: expression },
        { userName: expression },
      ];
    }

    const lowerDate = from || startDate;
    const upperDate = to || endDate;
    if (lowerDate || upperDate) {
      filter.timestamp = {};
      if (lowerDate) {
        const date = new Date(lowerDate);
        if (Number.isNaN(date.getTime())) return res.status(400).json({ success: false, message: 'Invalid from date' });
        filter.timestamp.$gte = date;
      }
      if (upperDate) {
        const date = new Date(upperDate);
        if (Number.isNaN(date.getTime())) return res.status(400).json({ success: false, message: 'Invalid to date' });
        date.setHours(23, 59, 59, 999);
        filter.timestamp.$lte = date;
      }
    }

    const skip = (pageNumber - 1) * pageSize;
    const [logs, totalCount] = await Promise.all([
      AuditLog.find(filter).sort({ timestamp: -1 }).skip(skip).limit(pageSize).lean(),
      AuditLog.countDocuments(filter),
    ]);

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
