import express from 'express';
import { getForms } from '../../controllers/admin/formsController.js';
import { protect, requirePrivilege } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { validateGetFormsQuery } from '../../middleware/validationMiddleware.js';
import { rejectInvalidDates } from '../../middleware/adminParamsMiddleware.js';

const router = express.Router();

router.use(requireDb);
router.use(protect, requirePrivilege('dashboard', 'forms'));
router.use(rejectInvalidDates);

router.get('/', validateGetFormsQuery, getForms);

export default router;
