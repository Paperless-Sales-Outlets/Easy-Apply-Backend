import express from 'express';
import { sendOtp, verifyOtp, getOtpStatus } from '../controllers/otpController.js';

const router = express.Router();

// Public OTP routes for phone & email verification
router.post('/send', sendOtp);
router.post('/verify', verifyOtp);
router.get('/status', getOtpStatus);
router.post('/status', getOtpStatus);

// Dedicated email OTP routes
router.post('/send-email', sendOtp);
router.post('/verify-email', verifyOtp);
router.get('/status-email', getOtpStatus);
router.post('/status-email', getOtpStatus);

export default router;
