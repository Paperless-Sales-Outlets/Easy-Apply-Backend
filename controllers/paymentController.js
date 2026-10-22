import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import Application from '../models/Application.js';
import Connection from '../models/Connection.js';
import { sendPaymentConfirmationEmail } from '../services/emailService.js';

import {
  generatePayHereHash,
  verifyPayHereNotifyHash,
  formatPayHereAmount,
} from '../utils/payhere.js';


// ─────────────────────────────────────────────
// @desc    Create PayHere payment session & security hash
// @route   POST /api/payment/create (or /api/payments/create)
// @access  Public
// ─────────────────────────────────────────────
export const createPayHerePayment = async (req, res, next) => {
  try {
    const { orderId, amount, currency = 'LKR' } = req.body;

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      res.status(400);
      return next(new Error('Valid payment amount is required'));
    }

    const merchantId = (process.env.PAYHERE_MERCHANT_ID || '').trim();
    const merchantSecret = (process.env.PAYHERE_MERCHANT_SECRET || '').trim();

    if (!merchantId || !merchantSecret) {
      res.status(500);
      return next(new Error('PayHere merchant credentials are not configured on server'));
    }

    const finalOrderId = orderId ? String(orderId).trim() : `ORD-${Date.now()}`;
    const formattedAmount = formatPayHereAmount(amount);

    // Generate PayHere security hash securely on server
    const hash = generatePayHereHash(
      merchantId,
      finalOrderId,
      formattedAmount,
      currency,
      merchantSecret
    );

    // Create or update status in DB (Appointment / Application) if MongoDB is connected
    if (mongoose.connection.readyState === 1) {
      let appointment = await Appointment.findOne({ referenceNumber: finalOrderId });
      if (!appointment) {
        const app = await Application.findOne({ referenceNumber: finalOrderId });
        if (app) {
          app.paymentStatus = 'pending';
          app.status = 'pending payment';
          app.paymentDetails = {
            orderId: finalOrderId,
            amount: parseFloat(formattedAmount),
            currency: String(currency).toUpperCase(),
          };
          await app.save();
        }
      } else {
        // Appointment model does not have amount, paymentStatus, etc. fields natively but we might just ignore this or update what is valid.
        // Actually, Appointment model only has status: ['scheduled', 'in-progress', 'completed', 'cancelled']
        // It does not have paymentStatus, amount, etc.
        // So we probably shouldn't do anything here, or just let it pass.
      }
    } else {
      console.warn('⚠️ MongoDB is not connected. Generating PayHere hash without DB persistence.');
    }

    console.log(`\n💳 PayHere payment hash created: Order ${finalOrderId} | Amount: ${currency} ${formattedAmount}`);
    console.log(`   merchant_id: ${merchantId} | hash: ${hash}\n`);

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const basePath = (process.env.FRONTEND_BASE_PATH || '/Paperlessbackup/').replace(/\/$/, '');

    res.status(200).json({
      success: true,
      merchantId,
      merchant_id: merchantId,
      orderId: finalOrderId,
      order_id: finalOrderId,
      amount: formattedAmount,
      currency: String(currency).toUpperCase(),
      hash,
      // PayHere requires these URLs — empty strings cause "Unauthorized payment request"
      return_url: `${baseUrl}${basePath}/payment/success`,
      cancel_url: `${baseUrl}${basePath}/payment/cancel`,
      // NOTE: Server is on SLT private network, PayHere cannot reach it directly.
      // Using a public echo endpoint for sandbox testing only.
      // In production (once server has a public IP), change this back to:
      // notify_url: `${apiUrl}${basePath}/api/payment/notify`,
      notify_url: process.env.PAYHERE_NOTIFY_URL || 'https://httpbin.org/post',
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────
// @desc    Receive and verify PayHere IPN notification callback
// @route   POST /api/payment/notify (or /api/payments/notify)
// @access  Public (PayHere Webhook)
// ─────────────────────────────────────────────
export const handlePayHereNotify = async (req, res, next) => {
  try {
    const notifyData = req.body;
    console.log('\n🔔 PayHere IPN Webhook Received:', notifyData);

    const merchantSecret = (process.env.PAYHERE_MERCHANT_SECRET || '').trim();
    if (!merchantSecret) {
      console.error('❌ PAYHERE_MERCHANT_SECRET is missing');
      res.status(500);
      return next(new Error('Server configuration error'));
    }

    // Verify MD5 signature
    const isValidSignature = verifyPayHereNotifyHash(notifyData, merchantSecret);

    if (!isValidSignature) {
      console.error('⚠️ PayHere Notification Hash Verification Failed!');
      res.status(400);
      return next(new Error('Invalid PayHere security signature (md5sig verification failed)'));
    }

    const { order_id, payhere_amount, payhere_currency, status_code, payment_id, payhere_payment_id } = notifyData;
    const paymentId = payment_id || payhere_payment_id || '';
    const statusCodeStr = String(status_code);

    // PayHere status_code 2 = Successful payment
    if (statusCodeStr === '2') {
      console.log(`\n✅ PayHere Payment SUCCESS for Order ${order_id} | Payment ID: ${paymentId}`);

      // Track resolved data for the confirmation email
      let emailTo = null;
      let emailCustomerName = null;
      let emailReferenceNumber = order_id;
      let emailAmount = payhere_amount;
      let emailCurrency = payhere_currency || 'LKR';
      let emailServiceType = null;
      let emailPaidAt = new Date();

      if (mongoose.connection.readyState === 1) {
        // 1. Update Appointment
        const appointment = await Appointment.findOne({ referenceNumber: order_id });
        if (appointment) {
          appointment.paymentStatus = 'paid';
          appointment.status = 'confirmed';
          appointment.payherePaymentId = paymentId;
          appointment.paidAt = emailPaidAt;
          await appointment.save();
          console.log(`   Updated Appointment ${order_id}: paymentStatus=paid, status=confirmed`);

          // Collect email data from appointment
          if (appointment.email) emailTo = appointment.email;
          if (appointment.customerName) emailCustomerName = appointment.customerName;
          emailAmount = appointment.amount ?? emailAmount;
          emailCurrency = appointment.currency ?? emailCurrency;
          emailServiceType = appointment.serviceType;
          appointment.status = 'scheduled'; // Valid enum for Appointment instead of 'confirmed'
          // Optionally save notes about payment if needed, since other payment fields don't exist
          appointment.notes = appointment.notes ? appointment.notes + ` | Paid via PayHere: ${paymentId}` : `Paid via PayHere: ${paymentId}`;
          await appointment.save();
          console.log(`   Updated Appointment ${order_id}: status=scheduled`);
        }

        // 2. Update Application
        const application = await Application.findOne({
          $or: [{ referenceNumber: order_id }, { 'paymentDetails.orderId': order_id }],
        });
        if (application) {
          application.paymentStatus = 'paid';
          application.status = 'confirmed';
          if (!application.paymentDetails) application.paymentDetails = {};
          application.paymentDetails.payherePaymentId = paymentId;
          application.paymentDetails.paidAt = emailPaidAt;
          await application.save();
          console.log(`   Updated Application ${application.referenceNumber}: paymentStatus=paid, status=confirmed`);

          // Application data takes priority over appointment for email fields
          emailReferenceNumber = application.referenceNumber;
          emailServiceType = application.serviceType ?? emailServiceType;
          emailAmount = application.paymentDetails?.amount ?? emailAmount;
          emailCurrency = application.paymentDetails?.currency ?? emailCurrency;

          // Try email from application formData first
          const formEmail =
            application.formData?.email ||
            application.formData?.emailAddress ||
            application.formData?.customerEmail ||
            null;
          if (formEmail) emailTo = formEmail;

          // Try customer name from formData
          const formName =
            application.formData?.nameFull ||
            application.formData?.fullName ||
            application.formData?.customerName ||
            null;
          if (formName) emailCustomerName = formName;

          // If email still not resolved, look up Connection by phone
          if (!emailTo && application.phone) {
            const connection = await Connection.findOne({ telephone: application.phone }).select('email fullName');
            if (connection) {
              if (connection.email) emailTo = connection.email;
              if (!emailCustomerName && connection.fullName) emailCustomerName = connection.fullName;
            }
          }
        }

        // 3. Send payment confirmation email (non-blocking — errors are caught inside)
        await sendPaymentConfirmationEmail({
          to: emailTo,
          customerName: emailCustomerName,
          referenceNumber: emailReferenceNumber,
          orderId: order_id,
          amount: emailAmount,
          currency: emailCurrency,
          serviceType: emailServiceType,
          paidAt: emailPaidAt,
        });
      } else {
        console.warn('⚠️ MongoDB is not connected. Signature verified successfully.');
      }

      return res.status(200).send('OK');
    } else {
      console.warn(`\n⚠️ PayHere Payment non-success status (${status_code}) for Order ${order_id}`);

      const failureStatus = statusCodeStr === '0' ? 'pending' : 'failed';

      if (mongoose.connection.readyState === 1) {
        const appointment = await Appointment.findOne({ referenceNumber: order_id });
        if (appointment) {
          // Appointment does not have paymentStatus, you could update status to 'cancelled' or similar if needed.
          // Since it's pending/failed, we just leave it or log it.
          appointment.notes = appointment.notes ? appointment.notes + ` | Payment ${failureStatus}` : `Payment ${failureStatus}`;
          await appointment.save();
        }

        const application = await Application.findOne({
          $or: [{ referenceNumber: order_id }, { 'paymentDetails.orderId': order_id }],
        });
        if (application) {
          application.paymentStatus = failureStatus;
          await application.save();
        }
      }

      return res.status(200).send('OK');
    }
  } catch (error) {
    next(error);
  }
};


// ─────────────────────────────────────────────
// @desc    Resolve a PayHere order_id to an application reference number
// @route   GET /api/payment/order/:orderId
// @access  Public
// ─────────────────────────────────────────────
export const getOrderByOrderId = async (req, res, next) => {
  const { orderId } = req.params;

  if (!orderId) {
    res.status(400);
    return next(new Error('orderId is required'));
  }

  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(200).json({ success: false, referenceNumber: orderId });
    }

    // 1. Try Application whose paymentDetails.orderId matches
    const application = await Application.findOne({
      $or: [
        { 'paymentDetails.orderId': orderId },
        { referenceNumber: orderId },
      ],
    }).select('referenceNumber paymentStatus');

    if (application) {
      return res.status(200).json({
        success: true,
        referenceNumber: application.referenceNumber,
        paymentStatus: application.paymentStatus,
      });
    }

    // 2. Fallback to Appointment
    const appointment = await Appointment.findOne({ referenceNumber: orderId }).select('referenceNumber status');
    if (appointment) {
      return res.status(200).json({
        success: true,
        referenceNumber: appointment.referenceNumber,
        paymentStatus: appointment.status === 'scheduled' ? 'paid' : 'pending', // Hacky fallback since no paymentStatus natively
      });
    }

    // 3. Nothing found — return orderId as the reference
    return res.status(200).json({ success: false, referenceNumber: orderId });
  } catch (error) {
    next(error);
  }
};
