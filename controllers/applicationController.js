import mongoose from 'mongoose';
import Application from '../models/Application.js';
import Connection from '../models/Connection.js';
import Customer from '../models/Customer.js';
import Appointment from '../models/Appointment.js';
import { sendApplicationSubmittedEmail } from '../services/emailService.js';


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

    // Extract phone
    const verifiedPhone =
      phone || formData?.phone || formData?.mobileNumber;

    if (!verifiedPhone) {
      res.status(400);
      return next(new Error('Verified phone number is required'));
    }

    const digitsOnly = String(verifiedPhone).replace(/\D/g, '');
    const last9 = digitsOnly.slice(-9);

    // Extract NIC
    let nic = formData?.nic || formData?.NIC || req.body.nic;
    if (!nic) {
      // Try resolving NIC from existing customer
      try {
        const existingCustomer = await Customer.findOne({
          $or: [
            { phone: digitsOnly },
            { phone: last9 },
            { phone: `0${last9}` },
            { phone: `+94${last9}` },
          ],
        }).select('NIC');
        if (existingCustomer?.NIC) nic = existingCustomer.NIC;
      } catch (_) {}
    }

    if (!nic) {
      nic = `NIC-${last9}`;
    }
    const cleanNic = String(nic).trim().toUpperCase();

    // Process uploaded files
    const uploadedDocuments = {};

    (Array.isArray(files) ? files : Object.values(files).flat()).forEach((file) => {
      if (!file) return;
      const key = file.fieldname;

      if (file.storageBackend === 'gridfs' && file.id) {
        uploadedDocuments[key] = `gridfs://${file.id}`;
      } else if (file.filename) {
        uploadedDocuments[key] = `/uploads/documents/${file.filename}`;
      }
    });

    // Existing customer validation (temporarily bypassed for seamless flow)
    // if (formData?.isExistingCustomer === 'yes' && !formData?.existingNumber?.trim()) { ... }

    // =====================================
    // New Connection Digital Workflow
    // =====================================
    if (serviceType === 'new-connection') {
      if (formData.declarationAccepted === undefined) {
        formData.declarationAccepted = true;
      }
      if (!formData.signature) {
        formData.signature = 'DIGITALLY_VERIFIED_OTP';
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
      nicFront: uploadedDocuments.nicFront || formData.nicFront || null,
      nicBack: uploadedDocuments.nicBack || formData.nicBack || null,
      passportDoc: uploadedDocuments.passportDoc || formData.passportDoc || null,
      brcDoc: uploadedDocuments.brcDoc || formData.brcDoc || null,
      vatDoc: uploadedDocuments.vatDoc || formData.vatDoc || null,
      taxExemptionDoc: uploadedDocuments.taxExemptionDoc || formData.taxExemptionDoc || null,
      signature: uploadedDocuments.signature || formData.signature || null,
    };

    let application;

    // MongoDB available
    if (mongoose.connection.readyState === 1) {
      // 1. Ensure Customer document exists in database
      try {
        let customerRecord = await Customer.findOne({
          $or: [
            { phone: digitsOnly },
            { phone: last9 },
            { phone: `0${last9}` },
            { phone: `+94${last9}` },
            { phone: `94${last9}` },
            { NIC: cleanNic },
          ],
        });

        const customerName =
          formData.nameFull ||
          formData.fullName ||
          formData.contactName ||
          formData.customerName ||
          'Customer';

        const addressLine = formData.installAddress || formData.address || formData.addressLine1 || '';

        if (!customerRecord) {
          customerRecord = await Customer.create({
            name: customerName,
            phone: digitsOnly,
            role: 'Customer',
            NIC: cleanNic,
            title: formData.title || 'Mr.',
            dob: formData.dob || '',
            gender: formData.gender || 'Male',
            nationality: formData.nationality || 'Sri Lankan',
            contactNumber: formData.contactNumber || formData.mobileNumber || digitsOnly,
            addressLine1: addressLine,
            city: formData.city || '',
            district: formData.district || '',
            postalCode: formData.postalCode || '',
            preferredContact: formData.preferredContact || 'SMS',
          });
        } else {
          // Update address or name if empty
          if (!customerRecord.addressLine1 && addressLine) customerRecord.addressLine1 = addressLine;
          if (!customerRecord.city && formData.city) customerRecord.city = formData.city;
          if (!customerRecord.district && formData.district) customerRecord.district = formData.district;
          if (!customerRecord.postalCode && formData.postalCode) customerRecord.postalCode = formData.postalCode;
          await customerRecord.save();
        }

        // Attach customer identity documents if not directly provided in current form
        if (customerRecord?.identityDocuments) {
          if (!formData.documents.nicFront && customerRecord.identityDocuments.nicFront) {
            formData.documents.nicFront = customerRecord.identityDocuments.nicFront;
          }
          if (!formData.documents.nicBack && customerRecord.identityDocuments.nicBack) {
            formData.documents.nicBack = customerRecord.identityDocuments.nicBack;
          }
          if (!formData.documents.facePhoto && customerRecord.identityDocuments.facePhoto) {
            formData.documents.facePhoto = customerRecord.identityDocuments.facePhoto;
          }
        }
      } catch (customerErr) {
        console.warn('Auto Customer persistence notice:', customerErr.message);
      }

      // 2. Create Application document
      application = await Application.create({
        phone: verifiedPhone,
        serviceType,
        formData,
        nic: cleanNic,
        status: 'pending',
        paymentStatus: formData.paymentReference ? 'paid' : 'pending',
        paymentDetails: formData.paymentReference
          ? {
              orderId: formData.paymentReference,
              amount: formData.product?.monthlyPrice || 2500,
              currency: 'LKR',
            }
          : undefined,
      });

      // 3. Auto-create Appointment if installation scheduling details are provided in formData
      const schedDate = formData.installationDate || formData.appointmentDate;
      if (schedDate) {
        try {
          const apptDate = new Date(schedDate);
          const dispatchId = `OPMC-JOB-${Math.floor(10000 + Math.random() * 90000)}`;
          const customerName = formData.nameFull || formData.fullName || 'Customer';
          const installAddress = formData.installAddress || formData.address || 'Installation Address';

          await Appointment.create({
            applicationId: application._id,
            referenceNumber: application.referenceNumber,
            customerName,
            phone: verifiedPhone,
            address: installAddress,
            serviceType,
            scheduledAt: apptDate,
            timeSlot: formData.installationTimeSlot || formData.timeSlot || 'Morning (08.30 AM - 12.00 PM)',
            landmarkNotes: formData.landmarkNotes || '',
            dispatchId,
            status: 'scheduled',
          });
        } catch (apptErr) {
          console.warn('Auto-create appointment notice:', apptErr.message);
        }
      }
    }

    // Offline fallback mode
    else {

      const refDigits = Math.floor(
        10000000 + Math.random() * 90000000
      ).toString();

      const prefix = serviceType === 'customer-request-acceptance' ? 'SR' : 'REQ';

      application = {
        _id: `mock_app_${refDigits}`,
        referenceNumber: `${prefix}-${refDigits}`,
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


    // ─────────────────────────────────────────────────────────
    // Send application submitted email (non-blocking)
    // ─────────────────────────────────────────────────────────
    (async () => {
      try {
        // 1. Try email in formData
        let emailTo =
          formData?.email ||
          formData?.emailAddress ||
          formData?.customerEmail ||
          null;

        // 2. Try to resolve name from formData
        const customerName =
          formData?.nameFull ||
          formData?.fullName ||
          formData?.customerName ||
          null;

        // 3. Fallback: look up Connection by phone for email
        if (!emailTo && verifiedPhone && mongoose.connection.readyState === 1) {
          const conn = await Connection.findOne({ telephone: verifiedPhone }).select('email fullName');
          if (conn?.email) emailTo = conn.email;
        }

        await sendApplicationSubmittedEmail({
          to: emailTo, // falls back to DEMO_CC inside emailService if null
          customerName,
          referenceNumber: application.referenceNumber,
          serviceType,
          phone: verifiedPhone,
          submittedAt: application.createdAt || new Date(),
          requiresPayment: application.paymentStatus === 'pending' && application.status === 'pending payment',
        });
      } catch (emailErr) {
        console.error('[applicationController] Email error:', emailErr.message);
      }
    })();

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
      .select('referenceNumber serviceType status createdAt formData notes');

    res.status(200).json({
      success: true,
      applications: applications.map((app) => ({
        referenceNumber: app.referenceNumber,
        serviceType: app.serviceType,
        status: app.status,
        createdAt: app.createdAt,
        formData: app.formData,
        adminComments: app.notes ? [{ text: app.notes }] : [],
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

    // Look up any scheduled installation appointment
    const appointment = await Appointment.findOne({
      $or: [
        { referenceNumber: application.referenceNumber },
        { applicationId: application._id },
      ],
    }).lean();

    res.status(200).json({
      success: true,
      referenceNumber: application.referenceNumber,
      status: application.status,
      serviceType: application.serviceType,
      customerName: application.formData?.nameFull || application.formData?.contactName || application.formData?.fullName || '',
      telephone: application.phone || '',
      notes: application.notes || '',
      formData: application.formData || {},
      officeFields: application.officeFields || {},
      appointment: appointment
        ? {
            scheduledAt: appointment.scheduledAt,
            timeSlot: appointment.timeSlot,
            dispatchId: appointment.dispatchId,
            status: appointment.status,
            landmarkNotes: appointment.landmarkNotes,
            feedback: appointment.feedback || null,
          }
        : application.officeFields?.appointmentDate
        ? {
            scheduledAt: application.officeFields.appointmentDate,
            timeSlot: 'Morning (08.30 AM - 12.00 PM)',
            dispatchId: 'OPMC-JOB-DISPATCH',
            status: 'scheduled',
          }
        : null,

      feedback: application.formData?.installationReview || appointment?.feedback || null,
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

// @desc    Check loop availability for installation address/city
// @route   POST /api/applications/check-loop
// @access  Public
export const checkLoopAvailability = async (req, res, next) => {
  try {
    const { address, city, district, latitude, longitude } = req.body;
    const searchString = `${address || ''} ${city || ''} ${district || ''}`.toLowerCase();

    // Check if explicitly unserviced or marked unavailable for testing/demo
    const isExplicitlyUnavailable =
      searchString.includes('no loop') ||
      searchString.includes('no-loop') ||
      searchString.includes('unavailable') ||
      searchString.includes('unserviced') ||
      searchString.includes('remote zone');

    // If address or city is provided and not explicitly marked unavailable
    const isAvailable = !isExplicitlyUnavailable && (searchString.trim().length > 0);

    if (isAvailable) {
      return res.status(200).json({
        success: true,
        available: true,
        message: 'Service loop is available in your area.',
        coverage: {
          area: city || district || 'Standard Service Area',
          loopStatus: 'AVAILABLE',
          estimatedProvisionDays: 3,
        },
      });
    } else {
      return res.status(200).json({
        success: true,
        available: false,
        message: 'No service loop available in this area. Please contact your nearest SLTMobitel branch.',
        coverage: {
          area: city || district || 'Unserviced Area',
          loopStatus: 'UNAVAILABLE',
          recommendedAction: 'CONTACT_NEAREST_BRANCH',
        },
      });
    }
  } catch (error) {
    next(error);
  }
};