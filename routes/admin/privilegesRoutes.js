import express from 'express';
import {
  getPrivileges,
  createPrivilege,
  updatePrivilege,
  deletePrivilege,
} from '../../controllers/admin/privilegesController.js';
import { protect, authorize } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { validateAdminId } from '../../middleware/adminValidation.js';

const router = express.Router();

// Malformed ids answer 404 before any controller or database query runs.
router.param('id', validateAdminId);

// Privilege Management (Admin only)
router.use(requireDb);
router.use(protect, authorize('admin'));

router.get('/', getPrivileges);
router.post('/', createPrivilege);
router.patch('/:id', updatePrivilege);
router.delete('/:id', deletePrivilege);

export default router;
