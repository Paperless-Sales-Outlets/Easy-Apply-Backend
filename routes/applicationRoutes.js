import express from 'express';
import {
  createApplication,
  getMyApplications,
  getApplicationById,
  updateApplicationStatus,
  checkApplicationStatus,
} from '../controllers/applicationController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';
import {
  validateApplicationSubmission,
  validateStatusUpdate,
  validatePublicStatusCheck,
} from '../middleware/validationMiddleware.js';

const router = express.Router();

// Public route for checking status
router.get('/check-status', validatePublicStatusCheck, checkApplicationStatus);

// Protected routes (require user log in)
router.post('/', protect, validateApplicationSubmission, createApplication);
router.get('/my', protect, getMyApplications);
router.get('/:id', protect, getApplicationById);

// Staff/Admin restricted route
router.patch('/:id/status', protect, authorize('Staff', 'Admin'), validateStatusUpdate, updateApplicationStatus);

export default router;
