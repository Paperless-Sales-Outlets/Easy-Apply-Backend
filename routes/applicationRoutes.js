import express from 'express';

import {
  createApplication,
  checkApplicationStatus,
  getApplicationsByPhone,
  lookupConnection,
  lookupPackage,
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


// Public route for looking up existing connection
router.get(
  '/lookup-connection',
  lookupConnection
);


// Public route for looking up customer current package (BRD 5.6)
router.get(
  '/lookup-package',
  lookupPackage
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