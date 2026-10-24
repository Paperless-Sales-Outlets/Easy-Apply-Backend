import express from 'express';
import { sendOtp, verifyOtp, sendEmailOtp, verifyEmailOtp } from '../controllers/otpController.js';

const router = express.Router();

// Phone OTP — bypassed with 000000 (no SMS gateway yet)
router.post('/send', sendOtp);
router.post('/verify', verifyOtp);

// Email OTP — real 6-digit code delivered via live SMTP
router.post('/send-email', sendEmailOtp);
router.post('/verify-email', verifyEmailOtp);

export default router;
