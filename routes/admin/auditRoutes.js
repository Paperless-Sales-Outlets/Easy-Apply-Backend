import express from 'express';
import { getAuditLogs } from '../../controllers/admin/auditController.js';
import { protect, authorize } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';

const router = express.Router();

router.use(requireDb, protect, authorize('admin'));
router.get('/', getAuditLogs);

export default router;
