import Application from '../models/Application.js';
import SalesOfficerQr from '../models/SalesOfficerQr.js';
import {
  getOfficerStatistics as fetchOfficerStats,
  getOrCreateOfficerQr,
  isCompletedSale,
  isSalesOfficerRole,
  buildQrUrl,
} from '../services/salesTrackingService.js';

// Helper to ensure authenticated user is a Sales Officer or Admin
const getAuthenticatedOfficer = (req) => {
  const user = req.user;
  if (!user) return null;
  return user;
};

// @desc    Retrieve statistics for the authenticated Sales Officer
// @route   GET /api/v1/sales-officer/me/statistics
// @access  Private (Sales Officer)
export const getMyStatistics = async (req, res, next) => {
  try {
    const user = getAuthenticatedOfficer(req);
    if (!user) {
      res.status(401);
      return next(new Error('Authentication required'));
    }

    if (!isSalesOfficerRole(user.role) && String(user.role).toLowerCase() !== 'admin') {
      res.status(403);
      return next(new Error('Only registered Sales Officers can access this resource'));
    }

    const stats = await fetchOfficerStats(user._id, user.employeeNumber, req.query);

    res.status(200).json({
      success: true,
      officer: {
        id: user._id,
        name: user.name,
        employeeNumber: user.employeeNumber,
        role: user.role,
      },
      statistics: stats,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Retrieve applications attributed to the authenticated Sales Officer
// @route   GET /api/v1/sales-officer/me/applications
// @access  Private (Sales Officer)
export const getMyApplications = async (req, res, next) => {
  try {
    const user = getAuthenticatedOfficer(req);
    if (!user) {
      res.status(401);
      return next(new Error('Authentication required'));
    }

    if (!isSalesOfficerRole(user.role) && String(user.role).toLowerCase() !== 'admin') {
      res.status(403);
      return next(new Error('Only registered Sales Officers can access this resource'));
    }

    const { page = 1, limit = 10, status, startDate, endDate, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    const filter = {
      $or: [{ salesOfficer: user._id }, { salesOfficerEmployeeNumber: user.employeeNumber }],
    };

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * pageSize;

    const allowedSortFields = ['createdAt', 'updatedAt', 'status', 'referenceNumber'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortDir = sortOrder === 'asc' ? 1 : -1;

    const [applications, totalCount] = await Promise.all([
      Application.find(filter)
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      Application.countDocuments(filter),
    ]);

    const mapped = applications.map((app) => ({
      id: app._id,
      referenceNumber: app.referenceNumber,
      serviceType: app.serviceType,
      status: app.status,
      paymentStatus: app.paymentStatus,
      nic: app.nic,
      phone: app.phone,
      customerName:
        app.formData?.nameFull ||
        app.formData?.fullName ||
        app.formData?.contactName ||
        'Customer',
      packageName:
        app.formData?.packageName ||
        app.formData?.selectedProduct ||
        app.formData?.broadbandPackage ||
        'New Connection',
      salesOfficerEmployeeNumber: app.salesOfficerEmployeeNumber,
      salesTrackingToken: app.salesTrackingToken,
      salesAttribution: app.salesAttribution,
      isCompletedSale: isCompletedSale(app),
      completedSaleAt: app.completedSaleAt || (isCompletedSale(app) ? app.createdAt : null),
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    }));

    const totalPages = Math.ceil(totalCount / pageSize);

    res.status(200).json({
      success: true,
      officer: {
        id: user._id,
        name: user.name,
        employeeNumber: user.employeeNumber,
      },
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount,
        pageSize,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
      applications: mapped,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Retrieve the authenticated Sales Officer's own QR tracking record and URL
// @route   GET /api/v1/sales-officer/me/qr
// @access  Private (Sales Officer)
export const getMyQr = async (req, res, next) => {
  try {
    const user = getAuthenticatedOfficer(req);
    if (!user) {
      res.status(401);
      return next(new Error('Authentication required'));
    }

    if (!isSalesOfficerRole(user.role) && String(user.role).toLowerCase() !== 'admin') {
      res.status(403);
      return next(new Error('Only registered Sales Officers can access this resource'));
    }

    const { qrRecord } = await getOrCreateOfficerQr(user, { regenerate: false });

    res.status(200).json({
      success: true,
      qr: {
        employeeNumber: user.employeeNumber,
        officerName: user.name,
        trackingToken: qrRecord.trackingToken,
        qrUrl: buildQrUrl(qrRecord.trackingToken),
        isActive: qrRecord.isActive,
        scansCount: qrRecord.scansCount || 0,
        lastScannedAt: qrRecord.lastScannedAt,
        createdAt: qrRecord.createdAt,
        regeneratedAt: qrRecord.regeneratedAt || null,
      },
    });
  } catch (error) {
    next(error);
  }
};
