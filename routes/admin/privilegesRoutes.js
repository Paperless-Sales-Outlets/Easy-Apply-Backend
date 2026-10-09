import express from 'express';
import {
  getPrivileges,
  createPrivilege,
  updatePrivilege,
  deletePrivilege,
} from '../../controllers/admin/privilegesController.js';
import { protect, authorize } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';

const router = express.Router();

// Privilege Management (Admin only)
router.use(requireDb);
router.use(protect, authorize('admin'));

router.get('/', getPrivileges);
router.post('/', createPrivilege);
router.patch('/:id', updatePrivilege);
router.delete('/:id', deletePrivilege);

export default router;
