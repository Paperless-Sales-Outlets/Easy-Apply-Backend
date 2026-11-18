import express from 'express';
import { getAnalytics, getUserReports, getApplicationReports } from '../../controllers/admin/analyticsController.js';
import { protect, requirePrivilege } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { rejectInvalidDates } from '../../middleware/adminParamsMiddleware.js';

const router = express.Router();

router.use(requireDb);
router.use(protect, requirePrivilege('analytics'));
router.use(rejectInvalidDates);

router.get('/reports/applications', getApplicationReports);
router.get('/reports', getUserReports);
router.get('/', getAnalytics);

export default router;
