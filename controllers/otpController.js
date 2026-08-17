import mongoose from 'mongoose';
import Otp from '../models/Otp.js';

// In-memory fallback store when MongoDB is offline
const inMemoryOtpStore = new Map();

// @desc    Generate and send OTP for phone verification
// @route   POST /api/otp/send
// @access  Public
export const sendOtp = async (req, res, next) => {
  const { phone } = req.body;

  if (!phone) {
    res.status(400);
    return next(new Error('Phone number is required'));
  }

  try {
    // Generate a 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    if (mongoose.connection.readyState === 1) {
      // Delete any existing OTP for this phone number
      await Otp.deleteMany({ phone });
      // Save to database (auto-expires in 5 minutes)
      await Otp.create({ phone, otp: otpCode });
    } else {
      // In-memory store fallback when DB is offline
      inMemoryOtpStore.set(String(phone).trim(), otpCode);
    }

    // Print OTP to server console for demo/testing purposes
    console.log(`\n📱 OTP for +94${phone}: ${otpCode} ${mongoose.connection.readyState !== 1 ? '(In-Memory Demo Mode)' : ''}\n`);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully. Check the server console.',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify OTP entered by user
// @route   POST /api/otp/verify
// @access  Public
export const verifyOtp = async (req, res, next) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    res.status(400);
    return next(new Error('Phone number and OTP are required'));
  }

  try {
    const cleanPhone = String(phone).trim();
    const cleanOtp = String(otp).trim();

    if (mongoose.connection.readyState === 1) {
      const record = await Otp.findOne({ phone: cleanPhone, otp: cleanOtp });

      if (!record) {
        res.status(400);
        return next(new Error('Invalid or expired OTP'));
      }

      // Delete OTP after successful verification
      await Otp.deleteMany({ phone: cleanPhone });
    } else {
      // Check in-memory store or accept default demo code '123456'
      const storedOtp = inMemoryOtpStore.get(cleanPhone);
      const isMatch = storedOtp === cleanOtp || cleanOtp === '123456';

      if (!isMatch) {
        res.status(400);
        return next(new Error('Invalid or expired OTP'));
      }

      inMemoryOtpStore.delete(cleanPhone);
    }

    res.status(200).json({
      success: true,
      message: 'Phone number verified successfully',
    });
  } catch (error) {
    next(error);
  }
};

