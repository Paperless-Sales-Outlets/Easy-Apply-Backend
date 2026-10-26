import mongoose from 'mongoose';

// Single Otp collection stores both phone OTPs and email OTPs.
// Phone OTPs:  { phone, otp }  — no real SMS, bypass 000000 is accepted.
// Email OTPs:  { email, otp }  — real 6-digit code sent via live SMTP.
// Neither field is required globally; validation is done in the controller.
const otpSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: false,
    trim: true,
    // NOT required — email OTPs are stored without a phone number
  },
  email: {
    type: String,
    required: false,
    trim: true,
    lowercase: true,
  },
  target: {
    type: String,
    required: false,
    trim: true,
    index: true,
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

const Otp = mongoose.models.Otp || mongoose.model('Otp', otpSchema);

export default Otp;
