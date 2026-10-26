import express from 'express';
import {
  getStaffRoles,
  createStaffRole,
  updateStaffRole,
  deleteStaffRole,
} from '../../controllers/admin/rolesController.js';
import { protect, authorize } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';

const router = express.Router();

// Role Management (Admin only)
router.use(requireDb);
router.use(protect, authorize('admin'));

router.get('/', getStaffRoles);
router.post('/', createStaffRole);
router.patch('/:id', updateStaffRole);
router.delete('/:id', deleteStaffRole);

export default router;
