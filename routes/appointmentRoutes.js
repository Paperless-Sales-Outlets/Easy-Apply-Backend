import express from 'express';
import {
  scheduleInstallation,
  getAppointmentByReference,
} from '../controllers/appointmentController.js';

const router = express.Router();

// Public route to schedule physical installation
router.post('/schedule', scheduleInstallation);

// Public route to fetch appointment by reference number
router.get('/by-ref/:ref', getAppointmentByReference);

export default router;
