import express from 'express';
import { getForms } from '../../controllers/admin/formsController.js';
import { protect, authorize } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { validateGetFormsQuery } from '../../middleware/validationMiddleware.js';

const router = express.Router();

router.use(requireDb);
router.use(protect, authorize('admin', 'staff'));

router.get('/', validateGetFormsQuery, getForms);

export default router;
