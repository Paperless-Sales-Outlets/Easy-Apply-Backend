import express from 'express';
import { sendOtp, verifyOtp, getOtpStatus } from '../controllers/otpController.js';

const router = express.Router();

// Public OTP routes for phone verification
router.post('/send', sendOtp);
router.post('/verify', verifyOtp);
router.get('/status', getOtpStatus);
router.post('/status', getOtpStatus);

export default router;
