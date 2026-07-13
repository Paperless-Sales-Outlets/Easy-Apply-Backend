import Application from '../models/Application.js';

// @desc    Submit a new service application
// @route   POST /api/applications
// @access  Private (Customer / Staff / Admin)
export const createApplication = async (req, res, next) => {
  const { serviceType, formData } = req.body;

  try {
    // Extract NIC from formData (checking common keys) or fallback to user's NIC
    const nic = formData?.nic || formData?.NIC || req.user.NIC;

    if (!nic) {
      res.status(400);
      return next(new Error('Identification (NIC / Passport / BR Number) is required'));
    }

    const application = await Application.create({
      userId: req.user._id,
      serviceType,
      formData,
      nic,
    });

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      application: {
        id: application._id,
        referenceNumber: application.referenceNumber,
        serviceType: application.serviceType,
        status: application.status,
        nic: application.nic,
        createdAt: application.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get logged in user's applications
// @route   GET /api/applications/my
// @access  Private (Customer / Staff / Admin)
export const getMyApplications = async (req, res, next) => {
  try {
    const applications = await Application.find({ userId: req.user._id })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: applications.length,
      applications,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get detailed view of a single application
// @route   GET /api/applications/:id
// @access  Private (Customer / Staff / Admin)
export const getApplicationById = async (req, res, next) => {
  try {
    const application = await Application.findById(req.params.id);

    if (!application) {
      res.status(404);
      return next(new Error('Application not found'));
    }

    // Access Control: Customers can only view their own applications.
    // Staff/Admin roles can view any application.
    if (
      req.user.role === 'Customer' &&
      application.userId.toString() !== req.user._id.toString()
    ) {
      res.status(403);
      return next(new Error('Not authorized to access this application'));
    }

    res.status(200).json({
      success: true,
      application,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update application status
// @route   PATCH /api/applications/:id/status
// @access  Private (Staff / Admin only)
export const updateApplicationStatus = async (req, res, next) => {
  const { status } = req.body;

  try {
    const application = await Application.findById(req.params.id);

    if (!application) {
      res.status(404);
      return next(new Error('Application not found'));
    }

    application.status = status;
    await application.save();

    res.status(200).json({
      success: true,
      message: `Application status updated to ${status}`,
      application,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Public status check using reference number and NIC
// @route   GET /api/applications/check-status
// @access  Public
export const checkApplicationStatus = async (req, res, next) => {
  const { ref, nic } = req.query;

  try {
    // Perform case-insensitive search for reference number and NIC match
    const application = await Application.findOne({
      referenceNumber: ref,
      nic: { $regex: new RegExp(`^${nic}$`, 'i') },
    });

    if (!application) {
      res.status(404);
      return next(new Error('No application found with these details. Please check the reference number and NIC.'));
    }

    res.status(200).json({
      success: true,
      referenceNumber: application.referenceNumber,
      status: application.status,
      serviceType: application.serviceType,
      createdAt: application.createdAt,
    });
  } catch (error) {
    next(error);
  }
};
