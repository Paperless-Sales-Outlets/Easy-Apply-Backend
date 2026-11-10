import express from 'express';
import {
  getKycQueue,
  reviewKycApplication,
  rerunKycAutoReview,
  sweepKycAutoReview,
  recheckAllKyc,
  getRecheckAllStatus,
  getKycDocument,
} from '../../controllers/admin/kycController.js';
import { protect, requirePrivilege } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { validateKycReview } from '../../middleware/validationMiddleware.js';

const router = express.Router();

// KYC review queue & actions (Admin/Staff only)
router.use(requireDb);
router.use(protect, requirePrivilege('kyc'));

// Get pending KYC review queue
router.get('/', getKycQueue);

// Automatically review every waiting case that has not been checked yet
router.post('/auto-review', sweepKycAutoReview);

// Re-check every open (pending / flagged) case with the current rules, and its progress
router.post('/recheck-all', recheckAllKyc);
router.get('/recheck-all', getRecheckAllStatus);

// Inline document image (kept out of the list so it stays small)
router.get('/:id/document/:key', getKycDocument);

// Run the automated check again for one case
router.post('/:id/auto-review', rerunKycAutoReview);

// Approve / reject / flag a KYC case with staff notes
router.patch('/:id/review', validateKycReview, reviewKycApplication);

export default router;
