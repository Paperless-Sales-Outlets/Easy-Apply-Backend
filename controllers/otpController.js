import mongoose from 'mongoose';
import Otp from '../models/Otp.js';

// In-memory fallback store when MongoDB is offline
const inMemoryOtpStore = new Map();

// Helper to normalize phone number string
const normalizePhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.slice(-9); // 9-digit national number e.g. 774053185
};

// @desc    Generate and send OTP for phone verification
// @route   POST /api/otp/send
// @access  Public
export const sendOtp = async (req, res, next) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({
      success: false,
      message: 'Phone number is required',
    });
  }

  try {
    const cleanPhone = normalizePhone(phone);
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    if (mongoose.connection.readyState === 1) {
      // Delete any existing OTP for this phone number variations
      await Otp.deleteMany({
        $or: [
          { phone: cleanPhone },
          { phone: `0${cleanPhone}` },
          { phone: `94${cleanPhone}` },
          { phone: String(phone).trim() },
        ],
      });
      // Save to database (auto-expires in 5 minutes)
      await Otp.create({ phone: cleanPhone, otp: otpCode });
    } else {
      inMemoryOtpStore.set(cleanPhone, otpCode);
    }

    console.log(`\n📱 OTP for +94 ${cleanPhone}: ${otpCode} (Demo Code: 000000)\n`);

    res.status(200).json({
      success: true,
      message: `OTP sent successfully. Demo code: ${otpCode} or 000000.`,
      otp: otpCode,
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
    return res.status(400).json({
      success: false,
      message: 'Phone number and OTP are required',
    });
  }

  try {
    const cleanPhone = normalizePhone(phone);
    const cleanOtp = String(otp).trim();

    // Accept demo/test bypass codes '000000' or '123456'
    if (cleanOtp === '000000' || cleanOtp === '123456') {
      return res.status(200).json({
        success: true,
        message: 'Phone number verified successfully',
      });
    }

    if (mongoose.connection.readyState === 1) {
      const record = await Otp.findOne({
        $or: [
          { phone: cleanPhone, otp: cleanOtp },
          { phone: `0${cleanPhone}`, otp: cleanOtp },
          { phone: `94${cleanPhone}`, otp: cleanOtp },
          { phone: String(phone).trim(), otp: cleanOtp },
        ],
      });

      if (!record) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired OTP code. Use demo code 000000.',
        });
      }

      // Delete OTP after successful verification
      await Otp.deleteMany({
        $or: [
          { phone: cleanPhone },
          { phone: `0${cleanPhone}` },
          { phone: `94${cleanPhone}` },
          { phone: String(phone).trim() },
        ],
      });
    } else {
      const storedOtp = inMemoryOtpStore.get(cleanPhone);
      const isMatch = storedOtp === cleanOtp;

      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired OTP code. Use demo code 000000.',
        });
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
