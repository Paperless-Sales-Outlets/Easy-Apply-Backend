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

<<<<<<< HEAD
    // Customer Type Checks (BRD 5.1.5)
    const customerType = formData?.customerType || 'home';
    const files = req.files || {};

    if (serviceType === 'new-connection') {
      if (customerType === 'business' && !formData.vatNumber?.trim()) {
        res.status(400);
        return next(new Error('VAT Registration Number is required for business customers (BRD 5.1.5).'));
=======

      const customerType = formData?.customerType || 'home';


      const hasNicFront =
        files.nicFront?.[0] || formData.nicFront;

      const hasNicBack =
        files.nicBack?.[0] || formData.nicBack;

      const hasPassport =
        files.passportDoc?.[0] || formData.passportDoc;

      const hasBrc =
        files.brcDoc?.[0] || formData.brcDoc;


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

>>>>>>> 789d79f0ffe682723d781829d07a04b1e3053b3b
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



// @desc    Public status check using reference number
// @route   GET /api/applications/check-status
// @access  Public
export const checkApplicationStatus = async (req, res, next) => {

  const { ref } = req.query;


  try {

    const application = await Application.findOne({
      referenceNumber: ref,
    });


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


  try {

    const connection = await Connection.findOne({
      telephone: phone,
    });


    if (connection) {

      return res.status(200).json({
        success: true,
        data: connection,
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