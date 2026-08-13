import express from 'express';
import { getDashboardStats } from '../../controllers/admin/dashboardStatsController.js';
import { protect, authorize } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';

const router = express.Router();

router.use(requireDb);
router.use(protect, authorize('admin', 'staff'));

router.get('/', getDashboardStats);

export default router;
