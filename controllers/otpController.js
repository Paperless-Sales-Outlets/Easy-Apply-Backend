import mongoose from 'mongoose';
import Otp from '../models/Otp.js';
import { sendOtpEmail } from '../services/emailService.js';

// In-memory fallback store when MongoDB is offline
const inMemoryOtpStore = new Map();
// Separate in-memory store for email OTPs
const inMemoryEmailOtpStore = new Map();

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

// @desc    Generate and send OTP to email address via live SMTP
// @route   POST /api/otp/send-email
// @access  Public
export const sendEmailOtp = async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email address is required' });
  }

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Persist OTP
    if (mongoose.connection.readyState === 1) {
      await Otp.deleteMany({ email: cleanEmail });
      await Otp.create({ email: cleanEmail, otp: otpCode });
    } else {
      inMemoryEmailOtpStore.set(cleanEmail, otpCode);
    }

    // Send email asynchronously in background so slow SMTP/network timeouts do not freeze the UI response
    sendOtpEmail({ to: cleanEmail, otpCode }).catch((smtpErr) => {
      console.error(`\n❌ [sendEmailOtp] SMTP delivery failed for ${cleanEmail}: ${smtpErr.message}`);
    });

    console.log(`\n📧 Email OTP for ${cleanEmail}: ${otpCode}  (bypass: 000000)\n`);

    res.status(200).json({
      success: true,
      message: 'Verification code sent to your email address.',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify email OTP entered by user
// @route   POST /api/otp/verify-email
// @access  Public
export const verifyEmailOtp = async (req, res, next) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Email and OTP code are required' });
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = String(otp).trim();

    // Bypass codes — always succeed (for devs and phone bypass parity)
    if (cleanOtp === '000000' || cleanOtp === '123456') {
      return res.status(200).json({ success: true, message: 'Email address verified successfully' });
    }

    if (mongoose.connection.readyState === 1) {
      const record = await Otp.findOne({ email: cleanEmail, otp: cleanOtp });

      if (!record) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired code. Check your email or use 000000.',
        });
      }

      await Otp.deleteMany({ email: cleanEmail });
    } else {
      const storedOtp = inMemoryEmailOtpStore.get(cleanEmail);
      if (storedOtp !== cleanOtp) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired code. Check your email or use 000000.',
        });
      }
      inMemoryEmailOtpStore.delete(cleanEmail);
    }

    res.status(200).json({ success: true, message: 'Email address verified successfully' });
  } catch (error) {
    next(error);
  }
};

