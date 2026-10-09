import express from 'express';
import {
  sendOtp,
  verifyOtp,
  register,
  login,
  refresh,
  logout,
  getUsers,
  getCustomers,
  checkPhone,
  otpLogin,
  verifyEntry,
  publicUser,
  publicCustomer,
} from '../controllers/authController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public routes
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/verify-entry', verifyEntry);
router.post('/register', register);
router.post('/login', login);
router.post('/otp-login', otpLogin);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.post('/check-phone', checkPhone);

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

router.get('/admin-only', protect, authorize('Admin'), (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome Admin! Access granted.',
  });
});

export default router;