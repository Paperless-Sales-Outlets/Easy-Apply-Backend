import Appointment from '../../models/Appointment.js';

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

    appointment.status = status;
    await appointment.save();

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
        status: appointment.status,
        notes: appointment.notes || '',
      },
    });
  } catch (error) {
    next(error);
  }
};
