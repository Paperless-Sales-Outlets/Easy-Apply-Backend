import express from 'express';
import {
  sendOtp,
  verifyOtp,
  register,
  login,
  refresh,
  logout,
  getUsers,
  checkPhone,
} from '../controllers/authController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public routes
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.post('/check-phone', checkPhone);

// Protected routes
router.get('/users', protect, authorize('Admin'), getUsers);

router.get('/me', protect, (req, res) => {
  res.status(200).json({
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      phone: req.user.phone,
      role: req.user.role,
      NIC: req.user.NIC,
    },
  });
});

router.get('/admin-only', protect, authorize('Admin'), (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome Admin! Access granted.',
  });
});

export default router;