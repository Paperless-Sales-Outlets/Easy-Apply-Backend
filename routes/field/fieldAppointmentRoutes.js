import express from 'express';
import { getMyAppointments, updateJobStatus } from '../../controllers/field/fieldAppointmentController.js';
import { protect, requirePrivilege } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';

const router = express.Router();

router.use(requireDb);
router.use(protect, requirePrivilege('technician'));

// Get appointments assigned to logged-in technician
router.get('/', getMyAppointments);

// Update job status
router.patch('/:id/status', updateJobStatus);

export default router;
