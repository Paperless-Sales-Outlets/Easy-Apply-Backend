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
import { protect, authorize } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';

const router = express.Router();

// Lead Management — the serviceability pipeline for new connections.
router.use(requireDb);
router.use(protect, authorize('admin', 'staff'));

// Static paths first so they are not captured by the /:id route.
router.get('/check-catalog', getLeadCheckCatalog);
router.get('/stats', getLeadStats);

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
