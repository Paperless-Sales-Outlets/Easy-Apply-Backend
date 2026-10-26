import express from 'express';
import {
  sendOtp,
  verifyOtp,
  otpLogin,
  register,
  login,
  refresh,
  logout,
  getUsers,
  getCustomers,
  verifyEntry,
  publicUser,
} from '../controllers/authController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';
import { getOtpStatus } from '../controllers/otpController.js';

const router = express.Router();

// Public routes
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.get('/otp-status', getOtpStatus);
router.post('/otp-status', getOtpStatus);
router.post('/otp-login', otpLogin);
router.post('/verify-entry', verifyEntry);
router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', logout);

// Protected routes
router.get('/users', protect, authorize('Admin'), getUsers);
router.get('/customers', protect, authorize('Admin'), getCustomers);

router.get('/me', protect, (req, res) => {
  const profile = publicUser(req.user);
  res.status(200).json({
    success: true,
    customer: profile,
    user: profile,
  });
});

export default router;