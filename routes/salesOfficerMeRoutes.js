import express from 'express';
import {
  getMyStatistics,
  getMyApplications,
  getMyQr,
} from '../controllers/salesOfficerMeController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';
import { requireDb } from '../middleware/dbMiddleware.js';

const router = express.Router();

router.use(requireDb);
router.use(protect, authorize('sales officer', 'admin'));

// Retrieve statistics for the authenticated officer
router.get('/me/statistics', getMyStatistics);

// Retrieve applications attributed to the authenticated officer
router.get('/me/applications', getMyApplications);

// Retrieve authenticated officer's own QR tracking record and URL
router.get('/me/qr', getMyQr);

export default router;
