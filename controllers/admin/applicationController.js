import Application from '../../models/admin/applicationModel.js';

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
    if (nic)             filter.nic             = { $regex: new RegExp(`^${nic}$`, 'i') };
    if (referenceNumber) filter.referenceNumber = { $regex: new RegExp(`^${referenceNumber}$`, 'i') };

    // Global search across referenceNumber and nic
    if (search && !nic && !referenceNumber) {
      filter.$or = [
        { referenceNumber: { $regex: search, $options: 'i' } },
        { nic:             { $regex: search, $options: 'i' } },
      ];
    }

    // Date range filter on createdAt
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate)   filter.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
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
      Application
        .find(filter)
        .populate('actionedBy', 'name email')
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

    const updates = { status };
    if (notes !== undefined) updates.notes = notes;
    if (req.user && req.user._id) {
      updates.actionedBy = req.user._id;
      updates.actionedAt = new Date();
    }

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

    res.status(200).json({ success: true, application });
  } catch (error) {
    next(error);
  }
};
