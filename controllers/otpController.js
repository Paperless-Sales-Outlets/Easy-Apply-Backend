import { requestOtp, validateOtp, getOtpStatus as checkOtpStatus } from '../services/otpService.js';

// @desc    Generate and send OTP for phone verification
// @route   POST /api/otp/send
// @access  Public
export const sendOtp = async (req, res, next) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({
      success: false,
      code: 'PHONE_REQUIRED',
      message: 'Phone number is required',
    });
  }

  try {
    const result = await requestOtp(phone);
    return res.status(200).json(result);
  } catch (error) {
    if (error.status === 429) {
      return res.status(429).json({
        success: false,
        code: error.code || 'TOO_MANY_REQUESTS',
        message: error.message,
        cooldownRemaining: error.cooldownRemaining,
        resendAvailableAt: error.resendAvailableAt,
        lockoutRemaining: error.lockoutRemaining,
        lockedUntil: error.lockedUntil,
      });
    }
    if (error.status === 400) {
      return res.status(400).json({
        success: false,
        code: error.code || 'BAD_REQUEST',
        message: error.message,
      });
    }
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
      code: 'INPUT_REQUIRED',
      message: 'Phone number and OTP code are required',
    });
  }

  try {
    const result = await validateOtp(phone, otp);
    return res.status(200).json(result);
  } catch (error) {
    const status = error.status || 400;
    return res.status(status).json({
      success: false,
      code: error.code || 'OTP_INVALID',
      message: error.message || 'Invalid or expired verification code.',
      attemptsRemaining: error.attemptsRemaining,
      lockoutRemaining: error.lockoutRemaining,
      lockedUntil: error.lockedUntil,
    });
  }
};

// @desc    Get OTP and lockout status for a phone number
// @route   GET /api/otp/status, POST /api/otp/status
// @access  Public
export const getOtpStatus = async (req, res, next) => {
  const phone = req.query.phone || req.body?.phone;

  if (!phone) {
    return res.status(400).json({
      success: false,
      code: 'PHONE_REQUIRED',
      message: 'Phone number is required',
    });
  }

  try {
    const status = await checkOtpStatus(phone);
    return res.status(200).json(status);
  } catch (error) {
    const code = error.status || 400;
    return res.status(code).json({
      success: false,
      code: error.code || 'BAD_REQUEST',
      message: error.message,
    });
  }
};
