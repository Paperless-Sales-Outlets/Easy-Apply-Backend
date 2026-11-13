import Application from '../../models/admin/applicationModel.js';
import User from '../../models/User.js';
import { recordAudit } from '../../services/auditService.js';
import { query } from '../../config/db.js';
import { buildWhereClause, formatColumnOrPath } from '../../db/modelHelper.js';
import { pickFrom, trimInline } from '../../db/jsonSelect.js';
import { escapeRegex } from '../../utils/employeeNumber.js';
import { sriLankaDayRange } from '../../utils/sriLankaDate.js';

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

// What the Forms search looks through. The form-data fields are the ones the
// admin list reads the applicant's name and NIC from.
const SEARCH_FIELDS = [
  'referenceNumber', 'nic', 'phone', 'formData.nic', 'formData.NIC',
  'formData.nameFull', 'formData.fullName', 'formData.contactName', 'formData.customerName',
  'formData.legalOwner', 'formData.currentCustomerName', 'formData.applicantName',
];

// Replaces each application's actionedBy id with who that staff member is.
const withActioners = async (applications) => {
  const ids = [...new Set(applications.map((app) => app.actionedBy).filter(Boolean))];
  if (!ids.length) return;
  const staff = await User.find({ _id: { $in: ids } }).select('_id name email role').lean();
  const byId = new Map(staff.map(({ _id, name, email, role }) => [_id, { _id, name, email, role }]));
  applications.forEach((app) => {
    app.actionedBy = byId.get(app.actionedBy) || app.actionedBy;
  });
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

    // Global search across the reference, NIC, phone and applicant name
    if (search && !nic && !referenceNumber) {
      filter.$or = SEARCH_FIELDS.map((field) => ({
        [field]: { $regex: escapeRegex(search), $options: 'i' },
      }));
    }

    // Date range filter on createdAt
    const createdRange = sriLankaDayRange(startDate, endDate);
    if (createdRange) filter.createdAt = createdRange;

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

    await withActioners(applications);

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

// @desc    One application's full form data, including the customer's images.
//          The Forms list leaves these out and asks for them when Documents is opened.
// @route   GET /api/admin/applications/:id/documents
// @access  Private (Forms privilege)
export const getApplicationDocuments = async (req, res, next) => {
  try {
    const application = await Application.findById(req.params.id).select('formData');
    if (!application) {
      res.status(404);
      return next(new Error('Application not found'));
    }
    res.status(200).json({ success: true, formData: application.formData || {} });
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

    const previous = await Application.findById(id).select('status referenceNumber serviceType');
    if (!previous) {
      res.status(404);
      return next(new Error('Application not found'));
    }

    // Saving a comment keeps the status; changing it is a KYC decision. Until the
    // business sets its own rules, only Admins and KYC reviewers may decide, and a
    // confirmed application (payment / appointment done) is locked, as in KYC Review.
    const currentStatus = String(previous.status || 'pending').toLowerCase();
    const statusChanges = currentStatus !== status;
    if (statusChanges) {
      const isAdmin = String(req.user?.role || '').toLowerCase() === 'admin';
      const canDecide = isAdmin || (req.user?.permissions || []).includes('kyc');
      if (!canDecide) {
        res.status(403);
        return next(new Error('Approving, rejecting or flagging an application needs the KYC Review privilege.'));
      }
      if (currentStatus === 'confirmed') {
        res.status(409);
        return next(new Error('This application is already confirmed (payment / appointment completed), so its status can no longer be changed.'));
      }
    }

    const updates = { status };
    if (statusChanges && (status === 'confirmed' || status === 'completed')) {
      updates.completedSale = true;
      updates.completedSaleAt = new Date();
    }
    if (notes !== undefined) updates.notes = notes;
    if (req.user && req.user._id) {
      updates.actionedBy = req.user._id;
      updates.actionedAt = new Date();
    }

    const application = await Application.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!application) {
      res.status(404);
      return next(new Error('Application not found'));
    }
    await withActioners([application]);

    await recordAudit({
      req,
      action: previous?.status === application.status ? 'ADD_COMMENT' : 'STATUS_UPDATE',
      module: 'Application',
      targetId: application.referenceNumber || id,
      description: previous?.status === application.status
        ? `Updated the comment (status stays ${application.status})`
        : `Changed status from ${previous?.status || 'unknown'} to ${application.status}`,
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
    );

    if (!application) {
      res.status(404);
      return next(new Error('Application not found'));
    }
    await withActioners([application]);

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
