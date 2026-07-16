import mongoose from 'mongoose';

const applicationSchema = new mongoose.Schema(
  {
    referenceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false, // Optional for passwordless flow
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
      ],
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'flagged'],
      default: 'pending',
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
    
    // Retry generation until a unique one is found
    while (!isUnique) {
      const randomDigits = Math.floor(10000000 + Math.random() * 90000000).toString();
      ref = `REQ-${randomDigits}`;
      
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
