import express from 'express';
import {
  getKycQueue,
  reviewKycApplication,
} from '../../controllers/admin/kycController.js';
import { protect, authorize } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { validateKycReview } from '../../middleware/validationMiddleware.js';

const router = express.Router();

// KYC review queue & actions (Admin/Staff only)
router.use(requireDb);
router.use(protect, authorize('admin', 'staff'));

// Get pending KYC review queue
router.get('/', getKycQueue);

// Approve / reject / flag a KYC case with staff notes
router.patch('/:id/review', validateKycReview, reviewKycApplication);

export default router;
