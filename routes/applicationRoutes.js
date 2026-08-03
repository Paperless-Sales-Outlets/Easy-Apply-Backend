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

import { handleFileUploads } from '../middleware/uploadMiddleware.js';


const router = express.Router();


// Public route for checking application status
router.get(
  '/check-status',
  validatePublicStatusCheck,
  checkApplicationStatus
);


// Public route for looking up existing connection
router.get(
  '/lookup-connection',
  lookupConnection
);


// Public endpoint for submitting applications
// Supports:
// - multipart/form-data
// - document uploads
// - digital signature
// - JSON formData payload
router.post(
  '/',
  handleFileUploads,
  parseMultipartFormData,
  validateApplicationSubmission,
  createApplication
);


export default router;