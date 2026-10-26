import express from 'express';
import {
  sendOtp,
  verifyOtp,
  getOtpStatus,
  sendEmailOtp,
  verifyEmailOtp,
} from '../controllers/otpController.js';

const router = express.Router();

// Public OTP routes for phone & email verification
router.post('/send', sendOtp);
router.post('/verify', verifyOtp);
router.get('/status', getOtpStatus);
router.post('/status', getOtpStatus);

// Dedicated email OTP routes (SMTP delivery + 5-minute expiry & lockout security)
router.post('/send-email', sendEmailOtp);
router.post('/verify-email', verifyEmailOtp);
router.get('/status-email', getOtpStatus);
router.post('/status-email', getOtpStatus);

export default router;
