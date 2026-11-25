import express from 'express';
import { getAnalytics, getUserReports, getApplicationReports } from '../../controllers/admin/analyticsController.js';
import { protect, requirePrivilege } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { validateDateQuery } from '../../middleware/adminValidation.js';

const router = express.Router();

router.use(requireDb);
router.use(protect, requirePrivilege('analytics'));

const validateReportDates = validateDateQuery(['from', 'to']);
router.get('/reports/applications', validateReportDates, getApplicationReports);
router.get('/reports', validateReportDates, getUserReports);
router.get('/', validateReportDates, getAnalytics);

export default router;
