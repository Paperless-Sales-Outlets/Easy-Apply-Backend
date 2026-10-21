import express from 'express';
import {
  createPayHerePayment,
  handlePayHereNotify,
  getOrderByOrderId,
} from '../controllers/paymentController.js';
import { validatePaymentCreate } from '../middleware/validationMiddleware.js';

const router = express.Router();

// PayHere Sandbox Payment API Endpoints
router.post('/create', validatePaymentCreate, createPayHerePayment);
router.post('/notify', handlePayHereNotify);
router.get('/order/:orderId', getOrderByOrderId);

export default router;

