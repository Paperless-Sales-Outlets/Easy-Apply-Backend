import express from 'express';
import { sendOtp, verifyOtp } from '../controllers/otpController.js';

const router = express.Router();

// Public OTP routes for phone verification
router.post('/send', sendOtp);
router.post('/verify', verifyOtp);

export default router;
