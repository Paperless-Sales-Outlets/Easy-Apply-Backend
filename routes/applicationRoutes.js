import express from 'express';
import {
  createApplication,
  checkApplicationStatus,
  lookupConnection,
} from '../controllers/applicationController.js';
import {
  validateApplicationSubmission,
  validatePublicStatusCheck,
} from '../middleware/validationMiddleware.js';
import { handleFileUploads } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// Public route for checking status
router.get('/check-status', validatePublicStatusCheck, checkApplicationStatus);

// Mock route for looking up existing connection
router.get('/lookup-connection', lookupConnection);

// Public endpoint for submitting applications with file uploads (phone-verified in wizard)
router.post(
  '/',
  handleFileUploads,
  validateApplicationSubmission,
  createApplication
);

export default router;
