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

const router = express.Router();

// Get paginated, filterable application list
router.use(requireDb);
router.use(protect);

router.get('/', requirePrivilege('dashboard', 'forms'), getAdminApplications);

// One application's images and other form data, for the Forms detail popup
router.get('/:id/documents', requirePrivilege('forms'), getApplicationDocuments);

// Update application status (approve / reject / flag / pending) + staff notes
router.patch('/:id/status', requirePrivilege('forms'), validateUpdateApplicationStatus, updateApplicationStatus);

// Update office fields (CR Number, Amount Paid, Staff Signature, Appointment Date)
router.patch('/:id/office-fields', requirePrivilege('forms'), validateOfficeFields, updateOfficeFields);

export default router;
