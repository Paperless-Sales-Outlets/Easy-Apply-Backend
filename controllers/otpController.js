import { requestOtp, validateOtp, getOtpStatus as checkOtpStatus } from '../services/otpService.js';

// @desc    Generate and send OTP for phone or email verification
// @route   POST /api/otp/send, POST /api/otp/send-email
// @access  Public
export const sendOtp = async (req, res, next) => {
  const target = req.body?.email || req.body?.phone || req.body?.target;

  if (!target) {
    return res.status(400).json({
      success: false,
      code: 'INPUT_REQUIRED',
      message: 'Phone number or email is required',
    });
  }

  try {
    const result = await requestOtp(target);
    return res.status(200).json(result);
  } catch (error) {
    if (error.status === 429) {
      return res.status(429).json({
        success: false,
        code: error.code || 'TOO_MANY_REQUESTS',
        message: error.message,
        otpRemaining: error.otpRemaining,
        expiresAt: error.expiresAt,
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

// @desc    Verify OTP entered by user (phone or email)
// @route   POST /api/otp/verify, POST /api/otp/verify-email
// @access  Public
export const verifyOtp = async (req, res, next) => {
  const target = req.body?.email || req.body?.phone || req.body?.target;
  const { otp } = req.body;

  if (!target || !otp) {
    return res.status(400).json({
      success: false,
      code: 'INPUT_REQUIRED',
      message: 'Phone number or email and OTP code are required',
    });
  }

  try {
    const result = await validateOtp(target, otp);
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

// @desc    Get OTP and lockout status for a phone number or email address
// @route   GET /api/otp/status, POST /api/otp/status, GET /api/otp/status-email, POST /api/otp/status-email
// @access  Public
export const getOtpStatus = async (req, res, next) => {
  const target =
    req.query?.email ||
    req.query?.phone ||
    req.query?.target ||
    req.body?.email ||
    req.body?.phone ||
    req.body?.target;

  if (!target) {
    return res.status(400).json({
      success: false,
      code: 'INPUT_REQUIRED',
      message: 'Phone number or email is required',
    });
  }

  try {
    const status = await checkOtpStatus(target);
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
