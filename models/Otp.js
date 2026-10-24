import mongoose from 'mongoose';

// Single Otp collection stores both phone OTPs and email OTPs.
// Phone OTPs:  { phone, otp }  — no real SMS, bypass 000000 is accepted.
// Email OTPs:  { email, otp }  — real 6-digit code sent via live SMTP.
// Neither field is required globally; validation is done in the controller.
const otpSchema = new mongoose.Schema({
  phone: {
    type: String,
    trim: true,
    // NOT required — email OTPs are stored without a phone number
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
  },
  otp: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300, // Auto-deleted after 5 minutes by MongoDB TTL index
  },
});

const Otp = mongoose.model('Otp', otpSchema);

export default Otp;
