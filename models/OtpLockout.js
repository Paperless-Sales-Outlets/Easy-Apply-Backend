import mongoose from 'mongoose';

const otpLockoutSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: false,
    sparse: true,
    trim: true,
    index: true,
  },
  email: {
    type: String,
    required: false,
    sparse: true,
    trim: true,
    lowercase: true,
    index: true,
  },
  target: {
    type: String,
    required: false,
    sparse: true,
    trim: true,
    index: true,
  },
  failedAttempts: {
    type: Number,
    default: 0,
  },
  lockedUntil: {
    type: Date,
    default: null,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
    expires: 3600, // 1 hour TTL so records clean up automatically
  },
});

const OtpLockout = mongoose.models.OtpLockout || mongoose.model('OtpLockout', otpLockoutSchema);

export default OtpLockout;
