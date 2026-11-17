import express from 'express';
import {
  BRANCH_LEVELS,
  getBranches,
  createBranch,
  updateBranch,
  deleteBranch,
} from '../../controllers/admin/branchesController.js';
import { protect, authorize } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { rejectInvalidId } from '../../middleware/adminParamsMiddleware.js';

const router = express.Router();

// Branches — regions, provinces, RTOs and teleshops. Admin only.
router.use(requireDb);
router.use(protect, authorize('admin'));

// :level is one of regions / provinces / rtos / teleshops.
router.param('level', (req, res, next, level) => {
  if (BRANCH_LEVELS[level]) return next();
  return res.status(404).json({ success: false, message: 'Not found' });
});
router.param('id', rejectInvalidId('Entry'));

router.get('/', getBranches);
router.post('/:level', createBranch);
router.patch('/:level/:id', updateBranch);
router.delete('/:level/:id', deleteBranch);

export default router;
