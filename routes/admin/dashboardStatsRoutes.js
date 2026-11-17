import express from 'express';
import { getDashboardStats } from '../../controllers/admin/dashboardStatsController.js';
import { protect, requirePrivilege } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { rejectInvalidDates } from '../../middleware/adminParamsMiddleware.js';

const router = express.Router();

router.use(requireDb);
router.use(protect, requirePrivilege('dashboard', 'forms'));
router.use(rejectInvalidDates);

router.get('/', getDashboardStats);

export default router;
