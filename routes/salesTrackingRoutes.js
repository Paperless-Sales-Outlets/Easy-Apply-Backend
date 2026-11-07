import express from 'express';
import { resolveTrackingToken } from '../controllers/salesTrackingController.js';
import { requireDb } from '../middleware/dbMiddleware.js';

const router = express.Router();

router.use(requireDb);

// Public tracking endpoint to validate token and return portal redirection info
router.get('/:token', resolveTrackingToken);

export default router;
