import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Application',
      default: null,
    },
    referenceNumber: {
      type: String,
      trim: true,
      default: '',
    },
    customerName: {
      type: String,
      trim: true,
      default: '',
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    serviceType: {
      type: String,
      enum: [
        'new-connection',
        'reconnection',
        'relocation',
        'termination',
        'transfer',
        'package-migration',
        'service-vacation',
        'refund-request',
        'customer-request-acceptance',
        'internet-services',
      ],
      default: 'new-connection',
    },
    scheduledAt: {
      type: Date,
      required: [true, 'Scheduled date/time is required'],
    },
    timeSlot: {
      type: String,
      trim: true,
      default: 'Morning (9:00 AM - 12:00 PM)',
    },
    landmarkNotes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [1000, 'Landmark notes must be at most 1000 characters'],
    },
    dispatchId: {
      type: String,
      trim: true,
      default: '',
    },
    technicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    status: {
      type: String,
      enum: ['scheduled', 'in-progress', 'completed', 'cancelled'],
      default: 'scheduled',
    },
    feedback: {
      rating: { type: Number, min: 1, max: 5, default: null },
      text: { type: String, trim: true, default: '' },
      submittedAt: { type: Date, default: null },
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [2000, 'Notes must be at most 2000 characters'],
    },
  },
  {
    timestamps: true,
  }
);

appointmentSchema.index({ referenceNumber: 1 });
appointmentSchema.index({ scheduledAt: 1 });
appointmentSchema.index({ technicianId: 1 });
appointmentSchema.index({ dispatchId: 1 });

const Appointment = mongoose.model('Appointment', appointmentSchema);

export default Appointment;
