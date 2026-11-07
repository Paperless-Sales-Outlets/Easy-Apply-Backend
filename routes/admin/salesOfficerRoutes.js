import express from 'express';
import {
  getSalesOfficers,
  createSalesOfficer,
  getSalesOfficerByEmployeeId,
  createOrGetOfficerQr,
  getOfficerQr,
  getOfficerStatistics,
  getOfficerApplications,
} from '../../controllers/admin/salesOfficerController.js';
import { protect, authorize } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';

const router = express.Router();

// Admin-only access with database check
router.use(requireDb);
router.use(protect, authorize('admin'));

// List registered Sales Officers
router.get('/', getSalesOfficers);

// Create a Sales Officer profile (6-digit employee number)
router.post('/', createSalesOfficer);

// Retrieve details for a specific officer by employee ID
router.get('/:employeeId', getSalesOfficerByEmployeeId);

// Create or retrieve QR tracking record for an officer
router.post('/:employeeId/qr', createOrGetOfficerQr);

// Retrieve existing QR tracking record and metadata
router.get('/:employeeId/qr', getOfficerQr);

// Retrieve real application and completed-sale statistics
router.get('/:employeeId/statistics', getOfficerStatistics);

// Retrieve applications attributed to this officer
router.get('/:employeeId/applications', getOfficerApplications);

export default router;
