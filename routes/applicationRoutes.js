import express from 'express';
import {
  createApplication,
  checkApplicationStatus,
  lookupConnection,
} from '../controllers/applicationController.js';
import {
  validateApplicationSubmission,
  validatePublicStatusCheck,
  parseMultipartFormData,
} from '../middleware/validationMiddleware.js';
import uploadMiddleware from '../middleware/uploadMiddleware.js';

const router = express.Router();

// Public route for checking status
router.get('/check-status', validatePublicStatusCheck, checkApplicationStatus);

// Mock route for looking up existing connection
router.get('/lookup-connection', lookupConnection);

// Public endpoint for submitting applications (phone-verified in wizard, supports multipart documents)
router.post('/', uploadMiddleware.any(), parseMultipartFormData, validateApplicationSubmission, createApplication);

export default router;
