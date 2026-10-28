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
      // Only new-connection is created now; the rest stay so older records still validate.
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
      enum: ['pending', 'pending payment', 'approved', 'confirmed', 'completed', 'rejected', 'flagged'],
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
    documents: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    officeFields: {
      crNumber: { type: String, trim: true, default: '' },
      amountPaid: { type: Number, default: null },
      staffSignature: { type: String, trim: true, default: '' },
      appointmentDate: { type: Date, default: null },
    },
    // Sales Officer Attribution (tracked via Sales Officer QR code)
    salesOfficer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    salesOfficerEmployeeNumber: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    salesTrackingToken: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    salesAttribution: {
      officerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      employeeNumber: { type: String, trim: true },
      officerName: { type: String, trim: true },
      trackingToken: { type: String, trim: true },
      attributedAt: { type: Date },
    },
    // Completed Sale Tracking
    completedSale: {
      type: Boolean,
      default: false,
      index: true,
    },
    completedSaleAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

applicationSchema.index({ salesOfficer: 1, createdAt: -1 });
applicationSchema.index({ salesOfficerEmployeeNumber: 1, createdAt: -1 });
applicationSchema.index({ salesOfficer: 1, status: 1 });
applicationSchema.index({ salesOfficer: 1, completedSale: 1 });

// Pre-validate hook to generate unique reference number if not set
applicationSchema.pre('validate', async function () {
  if (!this.referenceNumber) {
    let isUnique = false;
    let ref = '';
    
    const prefix = 'REQ';

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
});

const Application = mongoose.model('Application', applicationSchema);

export default Application;
