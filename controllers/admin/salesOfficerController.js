import User from '../../models/User.js';
import SalesOfficerQr from '../../models/SalesOfficerQr.js';
import Application from '../../models/Application.js';
import {
  findSalesOfficerByEmployeeNumber,
  getOrCreateOfficerQr,
  getOfficerStatistics as fetchOfficerStats,
  isCompletedSale,
  buildQrUrl,
} from '../../services/salesTrackingService.js';
import { recordAudit } from '../../services/auditService.js';

// Sanitize officer payload for response
const sanitizeOfficer = (u, qr = null) => ({
  id: u._id,
  name: u.name,
  email: u.email,
  employeeNumber: u.employeeNumber,
  role: u.role,
  phone: u.phone || null,
  isActive: u.isActive !== false,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
  qr: qr
    ? {
        hasQr: true,
        trackingToken: qr.trackingToken,
        qrUrl: buildQrUrl(qr.trackingToken),
        isActive: qr.isActive,
        scansCount: qr.scansCount || 0,
        lastScannedAt: qr.lastScannedAt,
        createdAt: qr.createdAt,
        regeneratedAt: qr.regeneratedAt || null,
      }
    : { hasQr: false },
});

// @desc    List all registered Sales Officers
// @route   GET /api/v1/admin/sales-officers
// @access  Private (Admin only)
export const getSalesOfficers = async (req, res, next) => {
  try {
    const officers = await User.find({
      role: { $regex: /^sales\s*officer$/i },
    })
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();

    // Fetch existing QR records for these officers in bulk
    const officerIds = officers.map((o) => o._id);
    const qrs = await SalesOfficerQr.find({ officer: { $in: officerIds } }).lean();
    const qrMap = new Map();
    qrs.forEach((qr) => {
      qrMap.set(String(qr.officer), qr);
    });

    const sanitized = officers.map((officer) =>
      sanitizeOfficer(officer, qrMap.get(String(officer._id)))
    );

    res.status(200).json({
      success: true,
      count: sanitized.length,
      salesOfficers: sanitized,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get details for a specific Sales Officer by employeeId
// @route   GET /api/v1/admin/sales-officers/:employeeId
// @access  Private (Admin only)
export const getSalesOfficerByEmployeeId = async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const officer = await findSalesOfficerByEmployeeNumber(employeeId);

    if (!officer) {
      res.status(404);
      return next(new Error(`Sales Officer with employee ID '${employeeId}' not found`));
    }

    const qr = await SalesOfficerQr.findOne({
      $or: [{ officer: officer._id }, { employeeNumber: officer.employeeNumber }],
    }).lean();

    res.status(200).json({
      success: true,
      salesOfficer: sanitizeOfficer(officer, qr),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a QR tracking record if one does not already exist, or return the existing record
// @route   POST /api/v1/admin/sales-officers/:employeeId/qr
// @access  Private (Admin only)
export const createOrGetOfficerQr = async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const regenerate = req.body?.regenerate === true || req.query?.regenerate === 'true';

    const officer = await findSalesOfficerByEmployeeNumber(employeeId);
    if (!officer) {
      res.status(404);
      return next(new Error(`Sales Officer with employee ID '${employeeId}' not found`));
    }

    const { qrRecord, created } = await getOrCreateOfficerQr(officer, {
      regenerate,
      metadata: req.body?.metadata || {},
    });

    await recordAudit({
      req,
      action: created ? 'CREATE' : regenerate ? 'UPDATE' : 'READ',
      module: 'Sales Officer Management',
      targetId: officer.employeeNumber,
      description: created
        ? `Generated QR tracking for Sales Officer ${officer.name} (${officer.employeeNumber})`
        : regenerate
          ? `Regenerated QR tracking token for Sales Officer ${officer.name} (${officer.employeeNumber})`
          : `Retrieved existing QR tracking for Sales Officer ${officer.name} (${officer.employeeNumber})`,
      metadata: {
        employeeNumber: officer.employeeNumber,
        trackingToken: qrRecord.trackingToken,
      },
    });

    res.status(created ? 201 : 200).json({
      success: true,
      created,
      regenerated: regenerate && !created,
      qr: {
        employeeNumber: officer.employeeNumber,
        officerName: officer.name,
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

// @desc    Retrieve the QR tracking URL and metadata for an officer
// @route   GET /api/v1/admin/sales-officers/:employeeId/qr
// @access  Private (Admin only)
export const getOfficerQr = async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const officer = await findSalesOfficerByEmployeeNumber(employeeId);

    if (!officer) {
      res.status(404);
      return next(new Error(`Sales Officer with employee ID '${employeeId}' not found`));
    }

    const qr = await SalesOfficerQr.findOne({
      $or: [{ officer: officer._id }, { employeeNumber: officer.employeeNumber }],
    }).lean();

    if (!qr) {
      res.status(404);
      return next(
        new Error(`No QR tracking record found for Sales Officer '${employeeId}'. Please generate one first.`)
      );
    }

    res.status(200).json({
      success: true,
      qr: {
        employeeNumber: officer.employeeNumber,
        officerName: officer.name,
        trackingToken: qr.trackingToken,
        qrUrl: buildQrUrl(qr.trackingToken),
        isActive: qr.isActive,
        scansCount: qr.scansCount || 0,
        lastScannedAt: qr.lastScannedAt,
        createdAt: qr.createdAt,
        regeneratedAt: qr.regeneratedAt || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Retrieve real application and completed-sale statistics for an officer
// @route   GET /api/v1/admin/sales-officers/:employeeId/statistics
// @access  Private (Admin only)
export const getOfficerStatistics = async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const officer = await findSalesOfficerByEmployeeNumber(employeeId);

    if (!officer) {
      res.status(404);
      return next(new Error(`Sales Officer with employee ID '${employeeId}' not found`));
    }

    const stats = await fetchOfficerStats(officer._id, officer.employeeNumber, req.query);

    res.status(200).json({
      success: true,
      officer: {
        id: officer._id,
        name: officer.name,
        employeeNumber: officer.employeeNumber,
        role: officer.role,
      },
      statistics: stats,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Retrieve applications attributed to a specific Sales Officer
// @route   GET /api/v1/admin/sales-officers/:employeeId/applications
// @access  Private (Admin only)
export const getOfficerApplications = async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const { page = 1, limit = 10, status, startDate, endDate, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    const officer = await findSalesOfficerByEmployeeNumber(employeeId);
    if (!officer) {
      res.status(404);
      return next(new Error(`Sales Officer with employee ID '${employeeId}' not found`));
    }

    const filter = {
      $or: [{ salesOfficer: officer._id }, { salesOfficerEmployeeNumber: officer.employeeNumber }],
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
        .populate('salesOfficer', 'name employeeNumber email')
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
        id: officer._id,
        name: officer.name,
        employeeNumber: officer.employeeNumber,
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
