import express from 'express';
import {
  getAppointments,
  getTechnicians,
  assignTechnician,
  createAppointment,
} from '../../controllers/admin/appointmentController.js';
import { protect, requirePrivilege } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { rejectInvalidId, rejectInvalidDates } from '../../middleware/adminParamsMiddleware.js';

const router = express.Router();

router.use(requireDb);
router.use(protect, requirePrivilege('appointments'));
router.use(rejectInvalidDates);
router.param('id', rejectInvalidId('Appointment'));

// List technicians (must be before /:id routes)
router.get('/technicians', getTechnicians);

// List appointments (filterable by date, technician, status)
router.get('/', getAppointments);

// Create appointment
router.post('/', createAppointment);

// Assign technician
router.patch('/:id/assign', assignTechnician);

export default router;
