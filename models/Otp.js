import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    trim: true,
  },
  otp: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 600, // 10-minute TTL cleanup in MongoDB background
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 5 * 60 * 1000), // Exactly 5 minutes validity
  },
  lastSentAt: {
    type: Date,
    default: Date.now,
  },
  failedAttempts: {
    type: Number,
    default: 0,
  },
});

const Otp = mongoose.model('Otp', otpSchema);

export default Otp;
