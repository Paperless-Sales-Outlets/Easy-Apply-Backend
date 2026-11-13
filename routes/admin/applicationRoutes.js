import express from 'express';
import {
  getAdminApplications,
  getApplicationDocuments,
  updateApplicationStatus,
  updateOfficeFields,
} from '../../controllers/admin/applicationController.js';
import { protect, requirePrivilege } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { validateUpdateApplicationStatus, validateOfficeFields } from '../../middleware/validationMiddleware.js';
import { requireValidId, rejectInvalidDates } from '../../middleware/adminParamsMiddleware.js';

const router = express.Router();

// Get paginated, filterable application list
router.use(requireDb);
router.use(protect);
// Privileges differ per route, so ids and dates are checked after each route's privilege.
const validId = requireValidId('Application');

router.get('/', requirePrivilege('dashboard', 'forms'), rejectInvalidDates, getAdminApplications);

// One application's images and other form data, for the Forms detail popup
router.get('/:id/documents', requirePrivilege('forms'), validId, getApplicationDocuments);

// Update application status (approve / reject / flag / pending) + staff notes
router.patch('/:id/status', requirePrivilege('forms'), validId, validateUpdateApplicationStatus, updateApplicationStatus);

// Update office fields (CR Number, Amount Paid, Staff Signature, Appointment Date)
router.patch('/:id/office-fields', requirePrivilege('forms'), validId, validateOfficeFields, updateOfficeFields);

export default router;
