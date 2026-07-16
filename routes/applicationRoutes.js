import express from 'express';
import {
  createApplication,
  checkApplicationStatus,
} from '../controllers/applicationController.js';
import {
  validateApplicationSubmission,
  validatePublicStatusCheck,
} from '../middleware/validationMiddleware.js';

const router = express.Router();

// Public route for checking status
router.get('/check-status', validatePublicStatusCheck, checkApplicationStatus);

// Public endpoint for submitting applications (phone-verified in wizard)
router.post('/', validateApplicationSubmission, createApplication);

export default router;
