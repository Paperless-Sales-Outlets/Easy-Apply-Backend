import mongoose from 'mongoose';

const applicationSchema = new mongoose.Schema(
  {
    referenceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Verified phone number is required'],
      trim: true,
    },
    serviceType: {
      type: String,
      required: true,
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
    },
    status: {
      type: String,
      enum: ['pending', 'pending payment', 'approved', 'confirmed', 'rejected', 'flagged'],
      default: 'pending',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending',
    },
    paymentDetails: {
      orderId: { type: String, trim: true },
      amount: { type: Number },
      currency: { type: String, default: 'LKR' },
      payherePaymentId: { type: String, trim: true },
      paidAt: { type: Date },
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [2000, 'Notes must be at most 2000 characters'],
    },
    actionedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    actionedAt: {
      type: Date,
      default: null,
    },
    nic: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    formData: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    officeFields: {
      crNumber: { type: String, trim: true, default: '' },
      amountPaid: { type: Number, default: null },
      staffSignature: { type: String, trim: true, default: '' },
      appointmentDate: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
  }
);

// Pre-validate hook to generate unique reference number if not set
applicationSchema.pre('validate', async function (next) {
  if (!this.referenceNumber) {
    let isUnique = false;
    let ref = '';
    
    // Determine prefix based on service type (BRD 5.9.6)
    const prefix = this.serviceType === 'customer-request-acceptance' ? 'SR' : 'REQ';

    // Retry generation until a unique one is found
    while (!isUnique) {
      const randomDigits = Math.floor(10000000 + Math.random() * 90000000).toString();
      ref = `${prefix}-${randomDigits}`;
      
      const existing = await mongoose.models.Application?.findOne({ referenceNumber: ref });
      if (!existing) {
        isUnique = true;
      }
    }
    
    this.referenceNumber = ref;
  }
  next();
});

const Application = mongoose.model('Application', applicationSchema);

export default Application;
