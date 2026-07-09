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
    expires: 300, // Expires and automatically deletes after 5 minutes (300 seconds)
  },
});

const Otp = mongoose.model('Otp', otpSchema);

export default Otp;
