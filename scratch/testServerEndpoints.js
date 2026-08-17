import express from 'express';
import dotenv from 'dotenv';
import paymentRoutes from '../routes/paymentRoutes.js';
import { errorHandler } from '../middleware/errorMiddleware.js';
import Appointment from '../models/Appointment.js';
import Application from '../models/Application.js';
import crypto from 'crypto';

dotenv.config();

// Mock Mongoose methods to allow testing endpoints even if MongoDB daemon is offline
Appointment.findOne = async () => null;
Appointment.create = async (data) => data;
Application.findOne = async () => null;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/payment', paymentRoutes);
app.use(errorHandler);

const PORT = 5097;
const server = app.listen(PORT, async () => {
  console.log(`Test Express server running on port ${PORT}`);

  try {
    // 1. Test POST /api/payment/create
    console.log('\n--- 1. Testing POST /api/payment/create ---');
    const resCreate = await fetch(`http://localhost:${PORT}/api/payment/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'TEST-ORDER-888',
        amount: 2500,
        currency: 'LKR',
        itemTitle: 'Appointment Booking',
        customerDetails: {
          name: 'John Doe',
          email: 'john@example.com',
          phone: '0771234567'
        }
      })
    });
    const jsonCreate = await resCreate.json();
    console.log('Response Status:', resCreate.status);
    console.log('Response Body:', jsonCreate);

    if (jsonCreate.success && jsonCreate.hash && jsonCreate.merchantId === '1237114') {
      console.log('✅ POST /api/payment/create endpoint test PASSED!');
    } else {
      console.error('❌ POST /api/payment/create endpoint test FAILED!');
    }

    // 2. Test POST /api/payment/notify
    console.log('\n--- 2. Testing POST /api/payment/notify ---');
    const merchantSecret = process.env.PAYHERE_MERCHANT_SECRET;
    const hashedSecret = crypto.createHash('md5').update(merchantSecret).digest('hex').toUpperCase();
    const notifyHashStr = '1237114' + 'TEST-ORDER-888' + '2500.00' + 'LKR' + '2' + hashedSecret;
    const validMd5sig = crypto.createHash('md5').update(notifyHashStr).digest('hex').toUpperCase();

    const notifyParams = new URLSearchParams({
      merchant_id: '1237114',
      order_id: 'TEST-ORDER-888',
      payhere_amount: '2500.00',
      payhere_currency: 'LKR',
      status_code: '2',
      payment_id: '320099998888',
      md5sig: validMd5sig
    });

    const resNotify = await fetch(`http://localhost:${PORT}/api/payment/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: notifyParams.toString()
    });

    const notifyText = await resNotify.text();
    console.log('Notify Response Status:', resNotify.status);
    console.log('Notify Response Body:', notifyText);

    if (resNotify.status === 200) {
      console.log('✅ POST /api/payment/notify endpoint test PASSED!');
    } else {
      console.error('❌ POST /api/payment/notify endpoint test FAILED!');
    }

  } catch (err) {
    console.error('Error during test:', err);
  } finally {
    server.close(() => {
      console.log('Test server closed cleanly.');
      process.exit(0);
    });
  }
});
