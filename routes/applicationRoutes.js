import express from 'express';
import multer from 'multer';
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

const router = express.Router();

const upload = multer({ dest: 'uploads/' });

// Public route for checking status
router.get('/check-status', validatePublicStatusCheck, checkApplicationStatus);

// Mock route for looking up existing connection
router.get('/lookup-connection', lookupConnection);

// Public endpoint for submitting applications (phone-verified in wizard)
router.post('/', upload.array('documents'), parseMultipartFormData, validateApplicationSubmission, createApplication);

export default router;
