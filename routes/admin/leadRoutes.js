import express from 'express';
import {
  getLeads,
  getLeadStats,
  getLeadCheckCatalog,
  getLeadById,
  createLead,
  updateLead,
  updateLeadChecks,
  resolveLead,
  deleteLead,
  recalculateLead,
} from '../../controllers/admin/leadController.js';
import {
  getDraftLeads,
  getDraftLeadStats,
  getDraftLeadById,
} from '../../controllers/admin/draftLeadController.js';
import { protect, authorize, requirePrivilege } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';

const router = express.Router();

// Lead Management — the serviceability pipeline for new connections.
router.use(requireDb);
router.use(protect, requirePrivilege('leads'));

// Static paths first so they are not captured by the /:id route.
router.get('/check-catalog', getLeadCheckCatalog);
router.get('/stats', getLeadStats);

// Abandoned New Connection drafts — the real unfinished applications.
router.get('/drafts', getDraftLeads);
router.get('/drafts/stats', getDraftLeadStats);
router.get('/drafts/:id', getDraftLeadById);

router.get('/', getLeads);
router.post('/', createLead);
router.get('/:id', getLeadById);
router.patch('/:id', updateLead);
router.patch('/:id/checks', updateLeadChecks);
router.patch('/:id/resolve', resolveLead);
router.post('/:id/recalculate', recalculateLead);

// Removing a lead is destructive — Admin only.
router.delete('/:id', authorize('admin'), deleteLead);

export default router;
