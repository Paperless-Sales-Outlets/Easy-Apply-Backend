import dotenv from 'dotenv';
dotenv.config();

import { sendPaymentConfirmationEmail } from './services/emailService.js';

// Uses seed data — Nimal Bandara (nimal.bandara@example.lk)
await sendPaymentConfirmationEmail({
    to: 'nimal.bandara@example.lk',
    customerName: 'Nimal Bandara',
    referenceNumber: 'REQ-12345678',
    orderId: 'ORD-TEST-001',
    amount: 3890.00,
    currency: 'LKR',
    serviceType: 'reconnection',
    paidAt: new Date(),
});

console.log('Done.');
process.exit(0);
