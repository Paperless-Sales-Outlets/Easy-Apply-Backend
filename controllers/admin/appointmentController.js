import Appointment from '../../models/Appointment.js';
import User from '../../models/User.js';

// @desc    Get appointments — filterable by date range, technician, status
// @route   GET /api/admin/appointments
// @access  Private (Admin / Staff only)
export const getAppointments = async (req, res, next) => {
  try {
    const { date, startDate, endDate, technicianId, status } = req.query;

    const filter = {};

    if (date) {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);
      filter.scheduledAt = { $gte: dayStart, $lte: dayEnd };
    } else if (startDate || endDate) {
      filter.scheduledAt = {};
      if (startDate) filter.scheduledAt.$gte = new Date(startDate);
      if (endDate) filter.scheduledAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    if (technicianId) filter.technicianId = technicianId;
    if (status) filter.status = status;

    const appointments = await Appointment.find(filter)
      .populate('technicianId', 'name email phone')
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
      technicianId: apt.technicianId?._id || null,
      technicianName: apt.technicianId?.name || null,
      status: apt.status,
      notes: apt.notes || '',
      createdAt: apt.createdAt,
    }));

    res.status(200).json({ success: true, count: mapped.length, appointments: mapped });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all staff users who can be assigned as technicians
// @route   GET /api/admin/appointments/technicians
// @access  Private (Admin / Staff only)
export const getTechnicians = async (req, res, next) => {
  try {
    const technicians = await User.find({ role: { $in: ['Staff', 'Admin'] } })
      .select('name email phone role')
      .sort({ name: 1 })
      .lean();

    res.status(200).json({ success: true, technicians });
  } catch (error) {
    next(error);
  }
};

// @desc    Assign a technician to an appointment
// @route   PATCH /api/admin/appointments/:id/assign
// @access  Private (Admin / Staff only)
export const assignTechnician = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { technicianId } = req.body;

    const updates = {};
    if (technicianId) {
      const tech = await User.findById(technicianId).select('name');
      if (!tech) {
        res.status(404);
        return next(new Error('Technician not found'));
      }
      updates.technicianId = technicianId;
    } else {
      updates.technicianId = null;
    }

    const appointment = await Appointment.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    )
      .populate('technicianId', 'name email phone')
      .lean();

    if (!appointment) {
      res.status(404);
      return next(new Error('Appointment not found'));
    }

    res.status(200).json({
      success: true,
      appointment: {
        id: appointment._id,
        applicationId: appointment.applicationId,
        referenceNumber: appointment.referenceNumber,
        customer: appointment.customerName,
        phone: appointment.phone,
        address: appointment.address,
        serviceType: appointment.serviceType,
        scheduledAt: appointment.scheduledAt,
        technicianId: appointment.technicianId?._id || null,
        technicianName: appointment.technicianId?.name || null,
        status: appointment.status,
        notes: appointment.notes || '',
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update appointment status (scheduled -> in-progress -> completed / cancelled)
// @route   PATCH /api/admin/appointments/:id/status
// @access  Private (Admin / Staff only)
export const updateAppointmentStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      res.status(400);
      return next(new Error('Status is required'));
    }

    const appointment = await Appointment.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true, runValidators: true }
    )
      .populate('technicianId', 'name email phone')
      .lean();

    if (!appointment) {
      res.status(404);
      return next(new Error('Appointment not found'));
    }

    res.status(200).json({
      success: true,
      appointment: {
        id: appointment._id,
        applicationId: appointment.applicationId,
        referenceNumber: appointment.referenceNumber,
        customer: appointment.customerName,
        phone: appointment.phone,
        address: appointment.address,
        serviceType: appointment.serviceType,
        scheduledAt: appointment.scheduledAt,
        technicianId: appointment.technicianId?._id || null,
        technicianName: appointment.technicianId?.name || null,
        status: appointment.status,
        notes: appointment.notes || '',
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a new appointment
// @route   POST /api/admin/appointments
// @access  Private (Admin / Staff only)
export const createAppointment = async (req, res, next) => {
  try {
    const { applicationId, referenceNumber, customerName, phone, address, serviceType, scheduledAt, technicianId, notes } = req.body;

    if (!scheduledAt) {
      res.status(400);
      return next(new Error('Scheduled date/time is required'));
    }

    const appointment = await Appointment.create({
      applicationId: applicationId || null,
      referenceNumber: referenceNumber || '',
      customerName: customerName || '',
      phone: phone || '',
      address: address || '',
      serviceType: serviceType || 'new-connection',
      scheduledAt,
      technicianId: technicianId || null,
      notes: notes || '',
    });

    res.status(201).json({ success: true, appointment: { id: appointment._id } });
  } catch (error) {
    next(error);
  }
};
