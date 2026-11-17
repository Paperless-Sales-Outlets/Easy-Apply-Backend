import express from 'express';
import {
  getDraftLeads,
  getDraftLeadStats,
  getDraftLeadById,
} from '../../controllers/admin/draftLeadController.js';
import { protect, requirePrivilege } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { rejectInvalidId, rejectInvalidDates } from '../../middleware/adminParamsMiddleware.js';

const router = express.Router();

// Lead Management — customers' unfinished New Connection applications.
router.use(requireDb);
router.use(protect, requirePrivilege('leads'));
router.use(rejectInvalidDates);
router.param('id', rejectInvalidId('Draft'));

router.get('/drafts', getDraftLeads);
router.get('/drafts/stats', getDraftLeadStats);
router.get('/drafts/:id', getDraftLeadById);

export default router;
