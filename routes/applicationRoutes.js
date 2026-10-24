import express from 'express';

import {
  createApplication,
  checkApplicationStatus,
  getApplicationsByPhone,
  checkLoopAvailability,
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


// Public route for listing a verified phone number's application history
router.get(
  '/by-phone',
  getApplicationsByPhone
);


// Public route for checking service loop availability
router.post(
  '/check-loop',
  checkLoopAvailability
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