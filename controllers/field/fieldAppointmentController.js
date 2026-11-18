import Appointment from '../../models/Appointment.js';
import Application from '../../models/Application.js';
import { recordAudit } from '../../services/auditService.js';

// @desc    Get appointments assigned to the logged-in technician
// @route   GET /api/field/appointments
// @access  Private (Staff / Admin only)
export const getMyAppointments = async (req, res, next) => {
  try {
    const technicianId = req.user._id;

    const appointments = await Appointment.find({ technicianId })
      .sort({ scheduledAt: 1 })
      .lean();

    const mapped = appointments.map(apt => ({
      id: apt._id,
      applicationId: apt.applicationId,
      referenceNumber: apt.referenceNumber,
      customer: apt.customerName,
      phone: apt.phone,
      address: apt.address,
      serviceType: apt.serviceType,
      scheduledAt: apt.scheduledAt,
      timeSlot: apt.timeSlot || null,
      status: apt.status,
      notes: apt.notes || '',
    }));

    res.status(200).json({ success: true, count: mapped.length, appointments: mapped });
  } catch (error) {
    next(error);
  }
};

// @desc    Update appointment status (scheduled -> in-progress -> completed)
// @route   PATCH /api/field/appointments/:id/status
// @access  Private (Staff / Admin only — must own the appointment)
export const updateJobStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      res.status(400);
      return next(new Error('Status is required'));
    }

    const allowed = ['in-progress', 'completed'];
    if (!allowed.includes(status)) {
      res.status(400);
      return next(new Error(`Status must be one of: ${allowed.join(', ')}`));
    }

    const appointment = await Appointment.findOne({ _id: id, technicianId: req.user._id });

    if (!appointment) {
      res.status(404);
      return next(new Error('Appointment not found or not assigned to you'));
    }

    // A job only moves forward: Scheduled → In progress → Completed.
    const previousStatus = appointment.status || 'scheduled';
    const NEXT_STATUS = { scheduled: 'in-progress', 'in-progress': 'completed' };
    const LABEL = { scheduled: 'Scheduled', 'in-progress': 'In progress', completed: 'Completed' };
    if (NEXT_STATUS[previousStatus] !== status) {
      res.status(409);
      return next(new Error(
        previousStatus === 'completed' || previousStatus === 'cancelled'
          ? `This job is already ${previousStatus}, so its status can no longer be changed.`
          : NEXT_STATUS[previousStatus]
            ? `This job is ${LABEL[previousStatus]}, so it can only be moved to ${LABEL[NEXT_STATUS[previousStatus]]}.`
            : 'This job\'s status can no longer be changed.'
      ));
    }
    appointment.status = status;
    await appointment.save();

    if (status === 'completed') {
      try {
        const appQuery = appointment.applicationId
          ? { _id: appointment.applicationId }
          : appointment.referenceNumber
            ? { referenceNumber: appointment.referenceNumber }
            : null;

        // Records the sale only: the admin pages don't track a 'completed' application status.
        // An application whose sale is already recorded keeps its original sale date.
        const application = appQuery ? await Application.findOne(appQuery).select('completedSale') : null;
        if (application && !application.completedSale) {
          await Application.findOneAndUpdate(
            appQuery,
            {
              $set: {
                completedSale: true,
                completedSaleAt: new Date(),
              },
            }
          );
        }
      } catch (syncErr) {
        console.warn('Notice: Failed to sync appointment completion to application:', syncErr.message);
      }
    }
    await recordAudit({
      req,
      action: 'STATUS_UPDATE',
      module: 'Appointments',
      targetId: appointment.referenceNumber || appointment._id,
      description: `Changed appointment status from ${previousStatus || 'unknown'} to ${status}`,
    });

    res.status(200).json({
      success: true,
      appointment: {
        id: appointment._id,
        referenceNumber: appointment.referenceNumber,
        customer: appointment.customerName,
        phone: appointment.phone,
        address: appointment.address,
        serviceType: appointment.serviceType,
        scheduledAt: appointment.scheduledAt,
        timeSlot: appointment.timeSlot || null,
        status: appointment.status,
        notes: appointment.notes || '',
      },
    });
  } catch (error) {
    next(error);
  }
};
