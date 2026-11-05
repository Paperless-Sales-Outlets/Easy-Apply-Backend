import express from 'express';
import {
  getRegistrationOptions,
  verifyRegistration,
  listPasskeys,
  deletePasskey,
  getAuthenticationOptions,
  verifyAuthentication,
} from '../controllers/passkeyController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// ── Public Passkey Authentication for Admin Login ──
router.post('/login-options', getAuthenticationOptions);
router.post('/login-verify', verifyAuthentication);

// ── Protected Passkey Management for Authenticated Admins / Staff ──
router.get('/registration-options', protect, getRegistrationOptions);
router.post('/verify-registration', protect, verifyRegistration);
router.get('/list', protect, listPasskeys);
router.delete('/:id', protect, deletePasskey);

export default router;

