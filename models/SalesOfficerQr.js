import mongoose from 'mongoose';

const salesOfficerQrSchema = new mongoose.Schema(
  {
    officer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Officer reference is required'],
      unique: true,
      index: true,
    },
    employeeNumber: {
      type: String,
      required: [true, 'Employee number is required'],
      unique: true,
      trim: true,
      index: true,
    },
    trackingToken: {
      type: String,
      required: [true, 'Tracking token is required'],
      unique: true,
      trim: true,
      index: true,
    },
    qrUrl: {
      type: String,
      required: [true, 'QR URL is required'],
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    scansCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastScannedAt: {
      type: Date,
      default: null,
    },
    regeneratedAt: {
      type: Date,
      default: null,
    },
    previousTokens: [
      {
        token: { type: String, trim: true },
        invalidatedAt: { type: Date, default: Date.now },
      },
    ],
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'sales_officer_qrs',
  }
);

const SalesOfficerQr = mongoose.model('SalesOfficerQr', salesOfficerQrSchema);

export default SalesOfficerQr;
