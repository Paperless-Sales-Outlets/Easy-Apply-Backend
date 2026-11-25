import express from 'express';
import { getDashboardStats } from '../../controllers/admin/dashboardStatsController.js';
import { protect, requirePrivilege } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { validateDateQuery } from '../../middleware/adminValidation.js';

const router = express.Router();

router.use(requireDb);
router.use(protect, requirePrivilege('dashboard', 'forms'));

router.get(
  '/',
  validateDateQuery(['startDate', 'endDate'], { range: ['startDate', 'endDate'], rejectReversed: true }),
  getDashboardStats
);

export default router;
