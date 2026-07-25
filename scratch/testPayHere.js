import { generatePayHereHash, verifyPayHereNotifyHash, formatPayHereAmount } from '../utils/payhere.js';
import dotenv from 'dotenv';
dotenv.config();

console.log('--- Testing PayHere Hash Generator ---');

const merchantId = process.env.PAYHERE_MERCHANT_ID || '1237114';
const merchantSecret = process.env.PAYHERE_MERCHANT_SECRET || 'MTA0ODE1MjY4MDQyNDI4MjAwNTUxNTU5NDAwOTUwMjg2MTUwMzA4Mg==';
const orderId = 'ORD-TEST-12345';
const amount = 1000;
const currency = 'LKR';

const hash = generatePayHereHash(merchantId, orderId, amount, currency, merchantSecret);

console.log('Merchant ID:', merchantId);
console.log('Order ID:', orderId);
console.log('Amount (Formatted):', formatPayHereAmount(amount));
console.log('Currency:', currency);
console.log('Generated Hash:', hash);

// Verify hash is 32 character hex string (MD5 uppercase)
if (typeof hash === 'string' && hash.length === 32 && /^[0-9A-F]+$/.test(hash)) {
  console.log('✅ Hash format test PASSED!');
} else {
  console.error('❌ Hash format test FAILED!');
}

console.log('\n--- Testing PayHere Notify IPN Verification ---');

// Simulate Notification Payload with status_code = 2 (Success)
const notifyData = {
  merchant_id: merchantId,
  order_id: orderId,
  payhere_amount: '1000.00',
  payhere_currency: 'LKR',
  status_code: '2',
  payment_id: '320012345678',
};

// Generate valid signature for this notify payload
import crypto from 'crypto';
const hashedSecret = crypto.createHash('md5').update(merchantSecret).digest('hex').toUpperCase();
const notifyHashStr = merchantId + orderId + '1000.00' + 'LKR' + '2' + hashedSecret;
const validMd5sig = crypto.createHash('md5').update(notifyHashStr).digest('hex').toUpperCase();

notifyData.md5sig = validMd5sig;

const isValid = verifyPayHereNotifyHash(notifyData, merchantSecret);
console.log('Calculated IPN Sig:', validMd5sig);
console.log('Verification result:', isValid);

if (isValid === true) {
  console.log('✅ PayHere Notify verification test PASSED!');
} else {
  console.error('❌ PayHere Notify verification test FAILED!');
}
