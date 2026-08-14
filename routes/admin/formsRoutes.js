import express from 'express';
import {
  getForms,
  getFormById,
  createForm,
  updateForm,
  deleteForm,
  addComment,
} from '../../controllers/admin/formsController.js';
import { protect, authorize } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import {
  validateAdminFormCreate,
  validateAdminFormUpdate,
  validateAddComment,
  validateGetFormsQuery,
} from '../../middleware/validationMiddleware.js';

const router = express.Router();

router.use(requireDb);
router.use(protect, authorize('admin', 'staff'));

router.get('/', validateGetFormsQuery, getForms);
router.post('/', validateAdminFormCreate, createForm);
router.get('/:id', getFormById);
router.put('/:id', validateAdminFormUpdate, updateForm);
router.delete('/:id', deleteForm);

// Comments
router.post('/:id/comments', validateAddComment, addComment);

export default router;
