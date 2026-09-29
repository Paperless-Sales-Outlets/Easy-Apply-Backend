import express from 'express';
import {
  scheduleInstallation,
  getAppointmentByReference,
  submitInstallationReview,
} from '../controllers/appointmentController.js';

const router = express.Router();

// Public route to schedule physical installation
router.post('/schedule', scheduleInstallation);

// Public route to fetch appointment by reference number
router.get('/by-ref/:ref', getAppointmentByReference);

// Public route to submit installation feedback & sign-off
router.post('/review', submitInstallationReview);

export default router;

