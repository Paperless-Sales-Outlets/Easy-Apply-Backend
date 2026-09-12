import express from 'express';
import { getConsentConfig } from '../controllers/consentController.js';

const router = express.Router();

// Public route to get privacy notice configuration for the frontend
router.get('/config', getConsentConfig);

export default router;
