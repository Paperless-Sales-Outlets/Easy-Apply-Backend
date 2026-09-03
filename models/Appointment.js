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

appointmentSchema.index({ scheduledAt: 1 });
appointmentSchema.index({ technicianId: 1 });

const Appointment = mongoose.model('Appointment', appointmentSchema);

export default Appointment;
