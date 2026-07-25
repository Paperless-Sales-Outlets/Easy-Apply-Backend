import express from 'express';
import {
  setupIntent,
  confirmPaymentMethod,
  getMyMethods,
  deletePaymentMethod,
  chargePayment,
  webhookBillGenerated,
  createPayHerePayment,
  handlePayHereNotify,
} from '../controllers/paymentController.js';
import { validatePaymentCreate } from '../middleware/validationMiddleware.js';

const router = express.Router();

// PayHere Sandbox Payment API Endpoints
router.post('/create', validatePaymentCreate, createPayHerePayment);
router.post('/notify', handlePayHereNotify);

// Create a secure payment session (setup intent)
router.post('/setup-intent', setupIntent);

// Store tokenized card reference only
router.post('/confirm', confirmPaymentMethod);

// List saved payment methods for a phone number
router.get('/my-methods', getMyMethods);

// Remove a saved payment method
router.delete('/:id', deletePaymentMethod);

// Trigger auto-billing charge
router.post('/charge', chargePayment);

// BSS webhook — bill generated, trigger auto-charge
router.post('/webhook/bill-generated', webhookBillGenerated);

export default router;

