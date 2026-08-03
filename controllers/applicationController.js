import Application from '../models/Application.js';
import Connection from '../models/Connection.js';

// @desc    Submit a new service application
// @route   POST /api/applications
// @access  Public
export const createApplication = async (req, res, next) => {
  let { serviceType, formData, phone } = req.body;

  try {
    // If formData arrives as string (e.g., from multipart/form-data), parse it
    if (typeof formData === 'string') {
      try {
        formData = JSON.parse(formData);
      } catch (err) {
        res.status(400);
        return next(new Error('Invalid JSON structure in formData'));
      }
    }

    if (!formData || typeof formData !== 'object') {
      res.status(400);
      return next(new Error('Form data object is required'));
    }

    // Extract NIC & Phone
    const nic = formData?.nic || formData?.NIC;
    if (!nic) {
      res.status(400);
      return next(new Error('Identification (NIC / Passport / BR Number) is required'));
    }

    const verifiedPhone = phone || formData?.phone || formData?.mobileNumber;
    if (!verifiedPhone) {
      res.status(400);
      return next(new Error('Verified phone number is required'));
    }

    // Validate existing customer number if isExistingCustomer is 'yes'
    if (formData?.isExistingCustomer === 'yes' && !formData?.existingNumber?.trim()) {
      res.status(400);
      return next(new Error('Existing Telephone / Account number is required for existing SLTMobitel customers.'));
    }

    // Validate BRD 5.1.4: Mandatory Declaration & Signature for New Connection
    if (serviceType === 'new-connection') {
      if (!formData.declarationAccepted) {
        res.status(400);
        return next(new Error('Customer declaration must be accepted before submitting (BRD 5.1.4).'));
      }

      if (!formData.signature) {
        res.status(400);
        return next(new Error('Digital Signature is mandatory for application submission (BRD 5.1.4).'));
      }
    }

    // Customer Type Driven Mandatory Document Checks (BRD 5.1.3 & 5.1.5)
    const customerType = formData?.customerType || 'home';
    const files = req.files || {};

    const hasNicFront = files.nicFront?.[0] || formData.nicFront;
    const hasNicBack = files.nicBack?.[0] || formData.nicBack;
    const hasPassport = files.passportDoc?.[0] || formData.passportDoc;
    const hasBrc = files.brcDoc?.[0] || formData.brcDoc;

    if (serviceType === 'new-connection') {
      if (customerType === 'foreign') {
        if (!hasPassport) {
          res.status(400);
          return next(new Error('Passport main page upload is mandatory for foreign customers (BRD 5.1.3).'));
        }
      } else if (customerType === 'business') {
        if (!formData.vatNumber?.trim()) {
          res.status(400);
          return next(new Error('VAT Registration Number is required for business customers (BRD 5.1.5).'));
        }
        if (!hasBrc) {
          res.status(400);
          return next(new Error('Business Registration Certificate (BRC) upload is mandatory for business customers (BRD 5.1.3).'));
        }
      } else {
        // home, office, religious, government
        if (!hasNicFront || !hasNicBack) {
          res.status(400);
          return next(new Error('Both NIC Front and NIC Back document uploads are mandatory (BRD 5.1.3).'));
        }
      }
    }

    // Store uploaded document references in Application.formData.documents
    const documentReferences = {
      nicFront: files.nicFront?.[0]
        ? `/uploads/documents/${files.nicFront[0].filename}`
        : formData.nicFront || null,
      nicBack: files.nicBack?.[0]
        ? `/uploads/documents/${files.nicBack[0].filename}`
        : formData.nicBack || null,
      passportDoc: files.passportDoc?.[0]
        ? `/uploads/documents/${files.passportDoc[0].filename}`
        : formData.passportDoc || null,
      brcDoc: files.brcDoc?.[0]
        ? `/uploads/documents/${files.brcDoc[0].filename}`
        : formData.brcDoc || null,
      vatDoc: files.vatDoc?.[0]
        ? `/uploads/documents/${files.vatDoc[0].filename}`
        : formData.vatDoc || null,
      taxExemptionDoc: files.taxExemptionDoc?.[0]
        ? `/uploads/documents/${files.taxExemptionDoc[0].filename}`
        : formData.taxExemptionDoc || null,
    };

    formData.documents = documentReferences;

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
        documents: application.formData?.documents,
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
        data: connection,
      });
    }

    res.status(404);
    return next(new Error('Connection not found for this telephone number.'));
  } catch (error) {
    next(error);
  }
};
