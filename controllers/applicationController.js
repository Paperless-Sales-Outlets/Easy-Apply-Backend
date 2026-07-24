import Application from '../models/Application.js';
import Connection from '../models/Connection.js';
// @desc    Submit a new service application
// @route   POST /api/applications
// @access  Public
export const createApplication = async (req, res, next) => {
  const { serviceType, formData, phone } = req.body;

  try {
    // Extract NIC from formData (checking common keys)
    const nic = formData?.nic || formData?.NIC;

    if (!nic) {
      res.status(400);
      return next(new Error('Identification (NIC / Passport / BR Number) is required'));
    }

    // Extract phone from top-level body, formData, or mobileNumber
    const verifiedPhone = phone || formData?.phone || formData?.mobileNumber;

    if (!verifiedPhone) {
      res.status(400);
      return next(new Error('Verified phone number is required'));
    }

    const application = await Application.create({
      phone: verifiedPhone,
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

// @desc    Public status check using reference number
// @route   GET /api/applications/check-status
// @access  Public
export const checkApplicationStatus = async (req, res, next) => {
  const { ref } = req.query;

  try {
    // Perform search solely by reference number
    const application = await Application.findOne({
      referenceNumber: ref,
    });

    if (!application) {
      res.status(404);
      return next(new Error('No application found with this reference number. Please check and try again.'));
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

// @desc    Mock endpoint to lookup connection by phone number
// @route   GET /api/applications/lookup-connection
// @access  Public
export const lookupConnection = async (req, res, next) => {
  const { phone } = req.query;

  try {
    const connection = await Connection.findOne({ telephone: phone });

    if (connection) {
      return res.status(200).json({
        success: true,
        data: connection
      });
    }

    res.status(404);
    return next(new Error('Connection not found for this telephone number.'));
  } catch (error) {
    next(error);
  }
};
