import express from 'express';
import {
  register,
  login,
  refresh,
  logout,
  getUsers,
  verifyEntry,
  publicUser,
} from '../controllers/authController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public routes
router.post('/verify-entry', verifyEntry);
router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', logout);

// Protected routes
router.get('/users', protect, authorize('Admin'), getUsers);

router.get('/me', protect, (req, res) => {
  const profile = publicUser(req.user);
  res.status(200).json({
    success: true,
    customer: profile,
    user: profile,
  });
});

export default router;