import express from 'express';
import {
  setupIntent,
  confirmPaymentMethod,
  getMyMethods,
  deletePaymentMethod,
  chargePayment,
  webhookBillGenerated,
} from '../controllers/paymentController.js';

const router = express.Router();

// Create a secure payment session
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
