import express from 'express';
import {
  getKycQueue,
  reviewKycApplication,
  rerunKycAutoReview,
  sweepKycAutoReview,
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

// Automatically review every waiting case that has not been checked yet
router.post('/auto-review', sweepKycAutoReview);

// Run the automated check again for one case
router.post('/:id/auto-review', rerunKycAutoReview);

// Approve / reject / flag a KYC case with staff notes
router.patch('/:id/review', validateKycReview, reviewKycApplication);

export default router;
