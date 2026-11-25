import express from 'express';
import {
  getAdminUsers,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
} from '../../controllers/admin/usersController.js';
import { protect, authorize } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { validateAdminId } from '../../middleware/adminValidation.js';

const router = express.Router();

// Malformed ids answer 404 before any controller or database query runs.
router.param('id', validateAdminId);

// User Management (Admin only)
router.use(requireDb);
router.use(protect, authorize('admin'));

router.get('/', getAdminUsers);
router.post('/', createAdminUser);
router.patch('/:id', updateAdminUser);
router.delete('/:id', deleteAdminUser);

export default router;
