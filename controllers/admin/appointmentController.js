import Appointment from '../../models/Appointment.js';
import { recordAudit } from '../../services/auditService.js';
import User from '../../models/User.js';
import { sriLankaDayRange } from '../../utils/sriLankaDate.js';

// @desc    Get appointments — filterable by date range, technician, status
// @route   GET /api/admin/appointments
// @access  Private (Admin / Staff only)
export const getAppointments = async (req, res, next) => {
  try {
    const { date, startDate, endDate, technicianId, status } = req.query;

    const filter = {};

    const scheduledRange = date ? sriLankaDayRange(date, date) : sriLankaDayRange(startDate, endDate);
    if (scheduledRange) filter.scheduledAt = scheduledRange;

    if (technicianId) filter.technicianId = technicianId;
    if (status) filter.status = status;

    const appointments = await Appointment.find(filter)
      .sort({ scheduledAt: 1 })
      .lean();

    const assignedIds = [...new Set(appointments.map((apt) => apt.technicianId).filter(Boolean))];
    const assignedStaff = assignedIds.length
      ? await User.find({ _id: { $in: assignedIds } }).select('_id name').lean()
      : [];
    const staffNames = new Map(assignedStaff.map(({ _id, name }) => [_id, name]));

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
      technicianId: apt.technicianId || null,
      technicianName: staffNames.get(apt.technicianId) || null,
      status: apt.status,
      notes: apt.notes || '',
      createdAt: apt.createdAt,
    }));

    res.status(200).json({ success: true, count: mapped.length, appointments: mapped });
  } catch (error) {
    next(error);
  }
};

// @desc    Get the active staff who hold the My Jobs privilege and can be assigned jobs
// @route   GET /api/admin/appointments/technicians
// @access  Private (Admin / Staff only)
export const getTechnicians = async (req, res, next) => {
  try {
    const staff = await User.find({ isActive: { $ne: false } })
      .select('_id name email phone role permissions')
      .sort({ name: 1 })
      .lean();

    const technicians = staff
      .filter((user) => (user.permissions || []).includes('technician'))
      .map(({ _id, name, email, phone, role }) => ({ _id, name, email, phone, role }));

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
    let technicianName = null;
    if (technicianId) {
      const tech = await User.findById(technicianId).select('name');
      if (!tech) {
        res.status(404);
        return next(new Error('Technician not found'));
      }
      updates.technicianId = technicianId;
      technicianName = tech.name;
    } else {
      updates.technicianId = null;
    }

    const previous = await Appointment.findById(id).select('technicianId referenceNumber');
    const appointment = await Appointment.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!appointment) {
      res.status(404);
      return next(new Error('Appointment not found'));
    }

    await recordAudit({
      req,
      action: 'UPDATE',
      module: 'Appointments',
      targetId: appointment.referenceNumber || id,
      description: `Updated appointment technician assignment`,
      metadata: { previousTechnicianId: previous?.technicianId || null, technicianId: updates.technicianId },
    });
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
        timeSlot: appointment.timeSlot || null,
        technicianId: updates.technicianId,
        technicianName,
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

    await recordAudit({
      req,
      action: 'CREATE',
      module: 'Appointments',
      targetId: appointment.referenceNumber || appointment._id,
      description: 'Created appointment',
    });
    res.status(201).json({ success: true, appointment: { id: appointment._id } });
  } catch (error) {
    next(error);
  }
};
