import Appointment from '../models/Appointment.js';
import Application from '../models/Application.js';

/**
 * @desc    Schedule a physical technical installation appointment
 * @route   POST /api/appointments/schedule
 * @access  Public
 */
export const scheduleInstallation = async (req, res, next) => {
  try {
    const {
      referenceNumber,
      appointmentDate,
      timeSlot,
      landmarkNotes,
      customerName,
      phone,
      address,
      serviceType,
    } = req.body;

    if (!appointmentDate) {
      res.status(400);
      return next(new Error('Appointment date is required'));
    }

    // Try to find the linked application if referenceNumber is provided
    let linkedApp = null;
    let finalCustomerName = customerName || '';
    let finalPhone = phone || '';
    let finalAddress = address || '';
    let finalServiceType = serviceType || 'new-connection';

    if (referenceNumber) {
      linkedApp = await Application.findOne({ referenceNumber: referenceNumber.trim() });
      if (linkedApp) {
        if (!finalCustomerName) {
          finalCustomerName =
            linkedApp.formData?.customerName ||
            linkedApp.formData?.fullName ||
            linkedApp.formData?.title + ' ' + (linkedApp.formData?.initials || '') + ' ' + (linkedApp.formData?.lastName || '') ||
            'Valued Customer';
        }
        if (!finalPhone) {
          finalPhone = linkedApp.phone || linkedApp.formData?.contactNumber || '';
        }
        if (!finalAddress) {
          finalAddress =
            linkedApp.formData?.installationAddress ||
            linkedApp.formData?.address ||
            `${linkedApp.formData?.addressLine1 || ''} ${linkedApp.formData?.city || ''}`.trim() ||
            'Installation Address';
        }
        if (linkedApp.serviceType) {
          finalServiceType = linkedApp.serviceType;
        }

        // Update application officeFields / status
        if (!linkedApp.officeFields) linkedApp.officeFields = {};
        linkedApp.officeFields.appointmentDate = new Date(appointmentDate);
        if (linkedApp.status === 'pending' || linkedApp.status === 'approved') {
          linkedApp.status = 'confirmed';
        }
        await linkedApp.save();
      }
    }

    // Generate random OPMC Dispatch ID if not existing
    const dispatchId = `OPMC-JOB-${Math.floor(10000 + Math.random() * 90000)}`;
    const parsedDate = new Date(appointmentDate);

    // Look for an existing appointment for this reference
    let appointment;
    if (referenceNumber) {
      appointment = await Appointment.findOne({ referenceNumber: referenceNumber.trim() });
    }

    if (appointment) {
      appointment.scheduledAt = parsedDate;
      appointment.timeSlot = timeSlot || appointment.timeSlot || 'Morning (08.30 AM - 12.00 PM)';
      appointment.landmarkNotes = landmarkNotes || appointment.landmarkNotes || '';
      if (!appointment.dispatchId) appointment.dispatchId = dispatchId;
      if (finalCustomerName) appointment.customerName = finalCustomerName;
      if (finalPhone) appointment.phone = finalPhone;
      if (finalAddress) appointment.address = finalAddress;
      appointment.status = 'scheduled';
      await appointment.save();
    } else {
      appointment = await Appointment.create({
        applicationId: linkedApp ? linkedApp._id : null,
        referenceNumber: referenceNumber ? referenceNumber.trim() : `SLT-REF-${Math.floor(100000 + Math.random() * 900000)}`,
        customerName: finalCustomerName || 'SLT Customer',
        phone: finalPhone || '0771234567',
        address: finalAddress || 'Service Address',
        serviceType: finalServiceType,
        scheduledAt: parsedDate,
        timeSlot: timeSlot || 'Morning (08.30 AM - 12.00 PM)',
        landmarkNotes: landmarkNotes || '',
        dispatchId,
        status: 'scheduled',
      });
    }


    res.status(200).json({
      success: true,
      message: 'Physical installation appointment scheduled successfully',
      appointment: {
        id: appointment._id,
        referenceNumber: appointment.referenceNumber,
        scheduledAt: appointment.scheduledAt,
        timeSlot: appointment.timeSlot,
        landmarkNotes: appointment.landmarkNotes,
        dispatchId: appointment.dispatchId,
        customerName: appointment.customerName,
        phone: appointment.phone,
        address: appointment.address,
        status: appointment.status,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get appointment details by reference number
 * @route   GET /api/appointments/by-ref/:ref
 * @access  Public
 */
export const getAppointmentByReference = async (req, res, next) => {
  try {
    const { ref } = req.params;
    if (!ref) {
      res.status(400);
      return next(new Error('Reference number is required'));
    }

    const appointment = await Appointment.findOne({ referenceNumber: ref.trim() }).lean();

    if (!appointment) {
      // Check if application exists
      const application = await Application.findOne({ referenceNumber: ref.trim() }).lean();
      if (!application) {
        res.status(404);
        return next(new Error('No appointment or application found for this reference'));
      }

      return res.status(200).json({
        success: true,
        exists: false,
        application: {
          referenceNumber: application.referenceNumber,
          customerName: application.formData?.fullName || application.formData?.customerName || '',
          phone: application.phone,
          serviceType: application.serviceType,
          address: application.formData?.installationAddress || application.formData?.address || '',
          status: application.status,
        },
      });
    }

    res.status(200).json({
      success: true,
      exists: true,
      appointment: {
        id: appointment._id,
        referenceNumber: appointment.referenceNumber,
        scheduledAt: appointment.scheduledAt,
        timeSlot: appointment.timeSlot,
        landmarkNotes: appointment.landmarkNotes,
        dispatchId: appointment.dispatchId,
        customerName: appointment.customerName,
        phone: appointment.phone,
        address: appointment.address,
        serviceType: appointment.serviceType,
        status: appointment.status,
        feedback: appointment.feedback || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Submit technician verification & installation feedback
 * @route   POST /api/appointments/review
 * @access  Public
 */
export const submitInstallationReview = async (req, res, next) => {
  try {
    const { referenceNumber, rating, feedbackText, ontDevice, speedTest } = req.body;

    if (!referenceNumber) {
      res.status(400);
      return next(new Error('Reference number is required'));
    }

    if (!rating || rating < 1 || rating > 5) {
      res.status(400);
      return next(new Error('Rating must be between 1 and 5'));
    }

    const trimmedRef = referenceNumber.trim();

    // 1. Update or create appointment record
    let appointment = await Appointment.findOne({ referenceNumber: trimmedRef });
    if (!appointment) {
      appointment = new Appointment({
        referenceNumber: trimmedRef,
        scheduledAt: new Date(),
        status: 'completed',
      });
    }

    appointment.feedback = {
      rating: Number(rating),
      text: (feedbackText || '').trim(),
      submittedAt: new Date(),
    };
    appointment.status = 'completed';
    await appointment.save();

    // 2. Update linked Application record if exists
    const linkedApp = await Application.findOne({ referenceNumber: trimmedRef });
    if (linkedApp) {
      if (linkedApp.status === 'pending' || linkedApp.status === 'approved') {
        linkedApp.status = 'confirmed';
      }
      if (!linkedApp.formData) linkedApp.formData = {};
      linkedApp.formData.installationReview = {
        rating: Number(rating),
        feedbackText: (feedbackText || '').trim(),
        ontDevice: ontDevice || 'ONT-HUAWEI-HG8245',
        speedTest: speedTest || { download: '104.2 Mbps', upload: '52.6 Mbps', ping: '4ms' },
        submittedAt: new Date(),
      };
      linkedApp.markModified('formData');
      await linkedApp.save();
    }

    res.status(200).json({
      success: true,
      message: 'Technician verification submitted and connection activated successfully',
      feedback: appointment.feedback,
      appointment,
    });
  } catch (error) {
    next(error);
  }
};

