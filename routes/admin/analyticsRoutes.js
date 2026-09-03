import express from 'express';
import { getAnalytics } from '../../controllers/admin/analyticsController.js';
import { protect, authorize } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';

const router = express.Router();

router.use(requireDb);
router.use(protect, authorize('admin', 'staff'));

router.get('/', getAnalytics);

export default router;
