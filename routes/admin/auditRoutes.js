import express from 'express';
import { getAuditLogs } from '../../controllers/admin/auditController.js';
import { protect, authorize } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { rejectInvalidDates } from '../../middleware/adminParamsMiddleware.js';

const router = express.Router();

router.use(requireDb, protect, authorize('admin'));
router.use(rejectInvalidDates);
router.get('/', getAuditLogs);

export default router;
