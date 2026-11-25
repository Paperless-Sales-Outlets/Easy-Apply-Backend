import express from 'express';
import {
  getAppointments,
  getTechnicians,
  assignTechnician,
  createAppointment,
} from '../../controllers/admin/appointmentController.js';
import { protect, requirePrivilege } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { validateAdminId, validateDateQuery } from '../../middleware/adminValidation.js';

const router = express.Router();

// Malformed ids answer 404 before any controller or database query runs.
router.param('id', validateAdminId);

router.use(requireDb);
router.use(protect, requirePrivilege('appointments'));

// List technicians (must be before /:id routes)
router.get('/technicians', getTechnicians);

// List appointments (filterable by date, technician, status)
router.get(
  '/',
  validateDateQuery(['date', 'startDate', 'endDate'], { range: ['startDate', 'endDate'], rejectReversed: true }),
  getAppointments
);

// Create appointment
router.post('/', createAppointment);

// Assign technician
router.patch('/:id/assign', assignTechnician);

export default router;
