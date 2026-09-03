import mongoose from 'mongoose';
import Application from '../models/Application.js';
import Connection from '../models/Connection.js';

// @desc    Submit a new service application
// @route   POST /api/applications
// @access  Public
export const createApplication = async (req, res, next) => {
  let { serviceType, formData, phone } = req.body;
  const files = req.files || {};

  try {
    // Parse formData if received as string
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

    // Extract NIC
    const nic = formData?.nic || formData?.NIC;

    if (!nic) {
      res.status(400);
      return next(
        new Error('Identification (NIC / Passport / BR Number) is required')
      );
    }

    // Extract phone
    const verifiedPhone =
      phone || formData?.phone || formData?.mobileNumber;

    if (!verifiedPhone) {
      res.status(400);
      return next(new Error('Verified phone number is required'));
    }


    // Process uploaded files
    const uploadedDocuments = {};

    Object.keys(files).forEach((key) => {
      if (files[key]?.[0]) {
        uploadedDocuments[key] = `/uploads/documents/${files[key][0].filename}`;
      }
    });


    // Existing customer validation
    if (
      formData?.isExistingCustomer === 'yes' &&
      !formData?.existingNumber?.trim()
    ) {
      res.status(400);
      return next(
        new Error(
          'Existing Telephone / Account number is required for existing SLTMobitel customers.'
        )
      );
    }


    // =====================================
    // New Connection BRD Validations
    // =====================================

    if (serviceType === 'new-connection') {

      // Declaration & Signature validation
      if (!formData.declarationAccepted) {
        res.status(400);
        return next(
          new Error(
            'Customer declaration must be accepted before submitting (BRD 5.1.4).'
          )
        );
      }


      if (!formData.signature) {
        res.status(400);
        return next(
          new Error(
            'Digital Signature is mandatory for application submission (BRD 5.1.4).'
          )
        );
      }


      const customerType = formData?.customerType || 'home';

      // Identity documents are only needed to establish who the customer is —
      // an existing SLTMobitel customer already has NIC/passport/BRC on file
      // from account creation, so don't make them re-upload it for a new
      // connection request.
      const isExistingCustomer = formData?.isExistingCustomer === 'yes';

      const hasNicFront =
        files.nicFront?.[0] || formData.nicFront;

      const hasNicBack =
        files.nicBack?.[0] || formData.nicBack;

      const hasPassport =
        files.passportDoc?.[0] || formData.passportDoc;

      const hasBrc =
        files.brcDoc?.[0] || formData.brcDoc;


      if (!isExistingCustomer) {

        // Foreign customer
        if (customerType === 'foreign') {

          if (!hasPassport) {
            res.status(400);
            return next(
              new Error(
                'Passport main page upload is mandatory for foreign customers (BRD 5.1.3).'
              )
            );
          }

        }

        // Business customer
        else if (customerType === 'business') {

          if (!formData.vatNumber?.trim()) {
            res.status(400);
            return next(
              new Error(
                'VAT Registration Number is required for business customers (BRD 5.1.5).'
              )
            );
          }


          if (!hasBrc) {
            res.status(400);
            return next(
              new Error(
                'Business Registration Certificate (BRC) upload is mandatory for business customers (BRD 5.1.3).'
              )
            );
          }

        }

        // Home / Office / Government / Religious
        else {

          if (!hasNicFront || !hasNicBack) {
            res.status(400);
            return next(
              new Error(
                'Both NIC Front and NIC Back document uploads are mandatory (BRD 5.1.3).'
              )
            );
          }

        }
      }
    }

    // =====================================
    // Package Migration BRD 5.6 Validations
    // =====================================
    if (serviceType === 'package-migration') {
      const effectiveDate = formData.effectiveDate;
      if (!effectiveDate) {
        res.status(400);
        return next(new Error('Effective Date is required for package migration (BRD 5.6).'));
      }

      const todayStr = new Date().toISOString().split('T')[0];
      if (effectiveDate < todayStr) {
        res.status(400);
        return next(new Error('Effective Date must be today or a future date. Past dates are not allowed (BRD 5.6).'));
      }

      const currentPkg = (formData.currentPackage || formData.existingPackage || '').trim().toLowerCase();
      const reqPkg = (formData.requiredPackage || formData.requestedPackage || '').trim().toLowerCase();

      if (currentPkg && reqPkg && currentPkg === reqPkg) {
        res.status(400);
        return next(new Error('Requested package cannot be the same as your current package (BRD 5.6).'));
      }
    }


    // Merge document references
    formData.documents = {
      ...uploadedDocuments,

      nicFront:
        uploadedDocuments.nicFront ||
        formData.nicFront ||
        null,

      nicBack:
        uploadedDocuments.nicBack ||
        formData.nicBack ||
        null,

      passportDoc:
        uploadedDocuments.passportDoc ||
        formData.passportDoc ||
        null,

      brcDoc:
        uploadedDocuments.brcDoc ||
        formData.brcDoc ||
        null,

      vatDoc:
        uploadedDocuments.vatDoc ||
        formData.vatDoc ||
        null,

      taxExemptionDoc:
        uploadedDocuments.taxExemptionDoc ||
        formData.taxExemptionDoc ||
        null,
    };


    let application;


    // MongoDB available
    if (mongoose.connection.readyState === 1) {

      application = await Application.create({
        phone: verifiedPhone,
        serviceType,
        formData,
        nic,
      });

    }

    // Offline fallback mode
    else {

      const refDigits = Math.floor(
        10000000 + Math.random() * 90000000
      ).toString();


      application = {
        _id: `mock_app_${refDigits}`,
        referenceNumber: `REQ-${refDigits}`,
        serviceType,
        status: 'pending',
        nic,
        formData,
        createdAt: new Date(),
      };


      console.log(
        `\n📝 Application submitted in DB Offline mode. Ref: ${application.referenceNumber}\n`
      );

    }


    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',

      application: {
        id: application._id || application.id,
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



// @desc    List applications submitted for a verified phone number
// @route   GET /api/applications/by-phone?phone=xxx
// @access  Public
export const getApplicationsByPhone = async (req, res, next) => {

  const { phone } = req.query;

  if (!phone) {
    res.status(400);
    return next(new Error('Phone number is required'));
  }

  const digitsOnly = String(phone).replace(/\D/g, '');
  const last9 = digitsOnly.slice(-9);

  try {
    const applications = await Application.find({
      $or: [
        { phone: phone },
        { phone: digitsOnly },
        { phone: `0${last9}` },
        { 'formData.mobileNumber': digitsOnly },
        { 'formData.mobileNumber': `0${last9}` },
      ],
    })
      .sort({ createdAt: -1 })
      .select('referenceNumber serviceType status createdAt');

    res.status(200).json({
      success: true,
      applications: applications.map((app) => ({
        referenceNumber: app.referenceNumber,
        serviceType: app.serviceType,
        status: app.status,
        createdAt: app.createdAt,
      })),
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

    const application = await Application.findOne({
      referenceNumber: ref,
    }).populate('actionedBy', 'name email role');


    if (!application) {
      res.status(404);
      return next(
        new Error(
          'No application found with this reference number. Please check and try again.'
        )
      );
    }


    res.status(200).json({

      success: true,
      referenceNumber: application.referenceNumber,
      status: application.status,
      serviceType: application.serviceType,
      customerName: application.formData?.nameFull || application.formData?.contactName || application.formData?.fullName || '',
      telephone: application.phone || '',
      notes: application.notes || '',
      actionedBy: application.actionedBy
        ? {
            _id: application.actionedBy._id,
            name: application.actionedBy.name,
            email: application.actionedBy.email,
            role: application.actionedBy.role,
          }
        : null,
      actionedAt: application.actionedAt || null,
      createdAt: application.createdAt,

    });


  } catch (error) {

    next(error);

  }

};



// @desc    Lookup connection by phone number
// @route   GET /api/applications/lookup-connection
// @access  Public
export const lookupConnection = async (req, res, next) => {

  const { phone } = req.query;

  const digitsOnly = String(phone || '').replace(/\D/g, '');
  const last9 = digitsOnly.slice(-9);

  try {
    const connections = await Connection.find({
      $or: [
        { telephone: phone },
        { telephone: digitsOnly },
        { telephone: `0${last9}` },
        { accountNo: phone },
        { contactNo: phone },
        { contactNo: digitsOnly },
        { contactNo: `0${last9}` },
      ]
    });

    if (connections && connections.length > 0) {
      return res.status(200).json({
        success: true,
        data: connections,
      });
    }


    res.status(404);

    return next(
      new Error(
        'Connection not found for this telephone number.'
      )
    );


  } catch (error) {

    next(error);

  }

};



// @desc    Lookup customer current package information by phone number (BRD 5.6)
// @route   GET /api/applications/lookup-package?phone=
// @access  Public
export const lookupPackage = async (req, res, next) => {
  const { phone } = req.query;

  if (!phone) {
    res.status(400);
    return next(new Error('Telephone number (phone) parameter is required.'));
  }

  const cleanPhone = phone.replace(/\D/g, '');
  const last9 = cleanPhone.slice(-9);

  try {
    let connection = null;

    if (mongoose.connection.readyState === 1) {
      connection = await Connection.findOne({
        $or: [
          { telephone: phone },
          { telephone: cleanPhone },
          { telephone: `0${last9}` },
          { accountNo: phone },
          { contactNo: phone },
          { contactNo: cleanPhone },
          { contactNo: `0${last9}` },
        ],
      });
    }

    if (connection) {
      return res.status(200).json({
        success: true,
        data: {
          telephone: connection.telephone,
          accountNo: connection.accountNo,
          customerName: connection.fullName,
          nic: connection.nic,
          contactNo: connection.contactNo,
          packageName: connection.packageName,
          currentPackage: connection.packageName,
          speed: connection.speed,
          monthlyPrice: connection.monthlyPrice,
          activationDate: connection.createdAt
            ? connection.createdAt.toISOString().split('T')[0]
            : null,
          status: connection.status,
        },
      });
    }

    return res.status(200).json({
      success: false,
      data: null,
      message: 'No customer found for this telephone number.',
    });
  } catch (error) {
    next(error);
  }
};