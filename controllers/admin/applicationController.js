import Application from '../../models/admin/applicationModel.js';
import { recordAudit } from '../../services/auditService.js';
import { query } from '../../config/db.js';
import { buildWhereClause, formatColumnOrPath } from '../../db/modelHelper.js';
import { pickFrom, trimInline } from '../../db/jsonSelect.js';
import { escapeRegex } from '../../utils/employeeNumber.js';

// The list without the base64 images stored inside the JSON columns, for pages
// that never show them (?lite=true). Inline images keep only their prefix.
const LITE_COLUMNS = [
  'id', 'reference_number', 'phone', 'service_type', 'status', 'payment_status', 'payment_details', 'notes',
  'actioned_by', 'actioned_at', 'nic', 'office_fields', 'sales_officer_id', 'sales_officer_employee_number',
  'sales_tracking_token', 'sales_attribution', 'completed_sale', 'completed_sale_at', 'created_at', 'updated_at',
  `${pickFrom('documents', null, 'd')} AS documents`,
  `${pickFrom('form_data', null, 'f', (v) =>
    `CASE WHEN f.k = 'documents' THEN ${pickFrom(v, null, 'n')} ELSE ${trimInline(v)} END`)} AS form_data`,
].join(', ');

const findLiteApplications = async (filter, sortField, sortDir, skip, limit) => {
  const { whereText, values } = buildWhereClause(filter);
  const { rows } = await query(
    `SELECT ${LITE_COLUMNS} FROM applications ${whereText}
     ORDER BY ${formatColumnOrPath(sortField)} ${sortDir === 1 ? 'ASC' : 'DESC'} LIMIT ${limit} OFFSET ${skip}`,
    values
  );
  return rows.map((row) => new Application(row));
};

// @desc    Get all applications — paginated, filterable list
// @route   GET /api/admin/applications
// @access  Private (Admin / Staff only)
export const getAdminApplications = async (req, res, next) => {
  try {
    const {
      page        = 1,
      limit       = 10,
      status,
      serviceType,
      nic,
      referenceNumber,
      search,
      startDate,
      endDate,
      sortBy      = 'createdAt',
      sortOrder   = 'desc',
    } = req.query;

    // --- Build Filter Query ---
    const filter = {};

    // Exact enum filters
    if (status)      filter.status      = status;
    if (serviceType) filter.serviceType = serviceType;

    // Case-insensitive exact match filters
    if (nic)             filter.nic             = { $regex: new RegExp(`^${escapeRegex(nic)}$`, 'i') };
    if (referenceNumber) filter.referenceNumber = { $regex: new RegExp(`^${escapeRegex(referenceNumber)}$`, 'i') };

    // Global search across referenceNumber and nic
    if (search && !nic && !referenceNumber) {
      filter.$or = [
        { referenceNumber: { $regex: escapeRegex(search), $options: 'i' } },
        { nic:             { $regex: escapeRegex(search), $options: 'i' } },
      ];
    }

    // Date range filter on createdAt
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate)   filter.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    if (req.query.salesOfficerEmployeeNumber) {
      filter.salesOfficerEmployeeNumber = String(req.query.salesOfficerEmployeeNumber).trim();
    }

    // --- Pagination ---
    const pageNum  = Math.max(1, parseInt(page,  10));
    const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip     = (pageNum - 1) * pageSize;

    // --- Sorting ---
    const allowedSortFields = ['createdAt', 'updatedAt', 'status', 'serviceType', 'referenceNumber'];
    const sortField         = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortDir           = sortOrder === 'asc' ? 1 : -1;

    // --- Execute Queries ---
    const [applications, totalCount] = await Promise.all([
      req.query.lite === 'true'
        ? findLiteApplications(filter, sortField, sortDir, skip, pageSize)
        : Application
          .find(filter)
          .populate('actionedBy', 'name email')
          .populate('salesOfficer', 'name email employeeNumber')
          .sort({ [sortField]: sortDir })
          .skip(skip)
          .limit(pageSize)
          .lean(),
      Application.countDocuments(filter),
    ]);

    const totalPages  = Math.ceil(totalCount / pageSize);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    res.status(200).json({
      success: true,
      pagination: {
        currentPage:  pageNum,
        totalPages,
        totalCount,
        pageSize,
        hasNextPage,
        hasPrevPage,
      },
      filters: {
        status:          status          || null,
        serviceType:     serviceType     || null,
        nic:             nic             || null,
        referenceNumber: referenceNumber || null,
        search:          search          || null,
        startDate:       startDate       || null,
        endDate:         endDate         || null,
      },
      sort: {
        sortBy:    sortField,
        sortOrder: sortDir === 1 ? 'asc' : 'desc',
      },
      applications,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update an application's status (approve / reject / flag / etc.)
//          Saves staff notes and records which admin/staff actioned the change.
// @route   PATCH /api/admin/applications/:id/status
// @access  Private (Admin / Staff only)
export const updateApplicationStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    // Guard: status must be present (validation middleware should catch this first,
    // but this prevents a 500 from Mongoose if it slips through)
    if (!status) {
      res.status(400);
      return next(new Error('Status is required'));
    }

    const updates = { status };
    if (status === 'confirmed' || status === 'completed') {
      updates.completedSale = true;
      updates.completedSaleAt = new Date();
    }
    if (notes !== undefined) updates.notes = notes;
    if (req.user && req.user._id) {
      updates.actionedBy = req.user._id;
      updates.actionedAt = new Date();
    }

    const previous = await Application.findById(id).select('status referenceNumber serviceType');
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

    await recordAudit({
      req,
      action: 'STATUS_UPDATE',
      module: 'Application',
      targetId: application.referenceNumber || id,
      description: `Changed status from ${previous?.status || 'unknown'} to ${application.status}`,
      metadata: { serviceType: application.serviceType, previousStatus: previous?.status, newStatus: application.status },
    });
    res.status(200).json({ success: true, application });
  } catch (error) {
    next(error);
  }
};

// @desc    Update office fields (CR Number, Amount Paid, Staff Signature, Appointment Date)
//          Staff-only operation — does not change application status.
// @route   PATCH /api/admin/applications/:id/office-fields
// @access  Private (Admin / Staff only)
export const updateOfficeFields = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { crNumber, amountPaid, staffSignature, appointmentDate } = req.body;

    const officeFields = {};
    if (crNumber !== undefined)      officeFields.crNumber      = crNumber;
    if (amountPaid !== undefined)    officeFields.amountPaid     = amountPaid !== null ? Number(amountPaid) : null;
    if (staffSignature !== undefined) officeFields.staffSignature = staffSignature;
    if (appointmentDate !== undefined) officeFields.appointmentDate = appointmentDate ? new Date(appointmentDate) : null;

    if (Object.keys(officeFields).length === 0) {
      res.status(400);
      return next(new Error('At least one office field is required'));
    }

    const application = await Application.findByIdAndUpdate(
      id,
      { $set: { officeFields } },
      { new: true, runValidators: true }
    )
      .populate('actionedBy', 'name email role')
      .lean();

    if (!application) {
      res.status(404);
      return next(new Error('Application not found'));
    }

    await recordAudit({
      req,
      action: 'UPDATE',
      module: 'Application',
      targetId: application.referenceNumber || id,
      description: 'Updated application office fields',
      metadata: { fields: Object.keys(officeFields) },
    });
    res.status(200).json({ success: true, application });
  } catch (error) {
    next(error);
  }
};
