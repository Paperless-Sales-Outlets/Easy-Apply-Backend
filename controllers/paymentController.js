import mongoose from 'mongoose';
import PaymentMethod from '../models/PaymentMethod.js';
import Appointment from '../models/Appointment.js';
import Application from '../models/Application.js';

import {
  generatePayHereHash,
  verifyPayHereNotifyHash,
  formatPayHereAmount,
} from '../utils/payhere.js';


// ─────────────────────────────────────────────
// @desc    Create a secure payment session (setup intent)
// @route   POST /api/payments/setup-intent
// @access  Public (phone-verified)
// ─────────────────────────────────────────────
export const setupIntent = async (req, res, next) => {
  const { phone } = req.body;

  if (!phone) {
    res.status(400);
    return next(new Error('Phone number is required'));
  }

  try {
    // In production: call your payment gateway (e.g. Stripe) to create a SetupIntent
    // and return its client_secret to the frontend widget.
    // Here we return a mock session token for demo purposes.
    const mockClientSecret = `si_mock_${Date.now()}_${phone}`;

    console.log(`\n💳 Payment setup intent created for +94${phone}\n`);

    res.status(200).json({
      success: true,
      clientSecret: mockClientSecret,
      message: 'Setup intent created. Use this to initialise the payment widget.',
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────
// @desc    Confirm and store tokenized card (no raw card data stored)
// @route   POST /api/payments/confirm
// @access  Public (phone-verified)
// ─────────────────────────────────────────────
export const confirmPaymentMethod = async (req, res, next) => {
  const { phone, token, cardBrand, last4, expiryMonth, expiryYear, autoPay } = req.body;

  if (!phone || !token || !cardBrand || !last4 || !expiryMonth || !expiryYear) {
    res.status(400);
    return next(new Error('All card details are required'));
  }

  try {
    // If autoPay is enabled, set all existing cards for this phone to non-default first
    if (autoPay) {
      await PaymentMethod.updateMany({ phone }, { isDefault: false });
    }

    const paymentMethod = await PaymentMethod.create({
      phone,
      token,
      cardBrand,
      last4,
      expiryMonth,
      expiryYear,
      isDefault: autoPay ? true : false,
      autoPay: autoPay || false,
    });

    console.log(`\n✅ Card saved for +94${phone}: ${cardBrand} ending in ${last4}\n`);

    res.status(201).json({
      success: true,
      message: 'Card saved successfully',
      paymentMethod: {
        id: paymentMethod._id,
        cardBrand: paymentMethod.cardBrand,
        last4: paymentMethod.last4,
        expiryMonth: paymentMethod.expiryMonth,
        expiryYear: paymentMethod.expiryYear,
        isDefault: paymentMethod.isDefault,
        autoPay: paymentMethod.autoPay,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────
// @desc    List all saved payment methods for a phone number
// @route   GET /api/payments/my-methods?phone=771234567
// @access  Public (phone-verified)
// ─────────────────────────────────────────────
export const getMyMethods = async (req, res, next) => {
  const { phone } = req.query;

  if (!phone) {
    res.status(400);
    return next(new Error('Phone number is required'));
  }

  try {
    const methods = await PaymentMethod.find({ phone }).sort({ isDefault: -1, createdAt: -1 });

    res.status(200).json({
      success: true,
      count: methods.length,
      paymentMethods: methods.map((m) => ({
        id: m._id,
        cardBrand: m.cardBrand,
        last4: m.last4,
        expiryMonth: m.expiryMonth,
        expiryYear: m.expiryYear,
        isDefault: m.isDefault,
        autoPay: m.autoPay,
        lastChargeStatus: m.lastChargeStatus,
        lastChargeAt: m.lastChargeAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────
// @desc    Remove a saved payment method
// @route   DELETE /api/payments/:id
// @access  Public (phone-verified)
// ─────────────────────────────────────────────
export const deletePaymentMethod = async (req, res, next) => {
  const { phone } = req.body;
  const { id } = req.params;

  if (!phone) {
    res.status(400);
    return next(new Error('Phone number is required'));
  }

  try {
    const method = await PaymentMethod.findOne({ _id: id, phone });

    if (!method) {
      res.status(404);
      return next(new Error('Payment method not found'));
    }

    await method.deleteOne();

    console.log(`\n🗑️  Card removed for +94${phone}: ${method.cardBrand} ending in ${method.last4}\n`);

    res.status(200).json({
      success: true,
      message: 'Payment method removed successfully',
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────
// @desc    Trigger an auto-billing charge on the default card
// @route   POST /api/payments/charge
// @access  Public (internal billing trigger)
// ─────────────────────────────────────────────
export const chargePayment = async (req, res, next) => {
  const { phone, amount, description } = req.body;

  if (!phone || !amount) {
    res.status(400);
    return next(new Error('Phone and amount are required'));
  }

  try {
    // Find the default auto-pay card for this phone
    const method = await PaymentMethod.findOne({ phone, isDefault: true, autoPay: true });

    if (!method) {
      res.status(404);
      return next(new Error('No default auto-pay card found for this phone number'));
    }

    // In production: call your payment gateway to charge using method.token
    // Here we simulate a successful charge
    const chargeSuccess = true; // Replace with real gateway response

    if (chargeSuccess) {
      method.lastChargeStatus = 'success';
      method.lastChargeAt = new Date();
      method.retryCount = 0;
      await method.save();

      console.log(`\n💰 Charge of LKR ${amount} successful for +94${phone} | ${description || ''}\n`);

      return res.status(200).json({
        success: true,
        message: `Charge of LKR ${amount} processed successfully`,
        chargeStatus: 'success',
      });
    }

    // Handle failed charge with retry logic
    method.lastChargeStatus = 'failed';
    method.lastChargeAt = new Date();
    method.retryCount += 1;
    await method.save();

    if (method.retryCount === 1) {
      // First failure — schedule retry after 24 hours
      console.log(`\n⚠️  Charge failed for +94${phone}. Will retry in 24 hours.\n`);
      return res.status(200).json({
        success: false,
        message: 'Charge failed. Retry scheduled in 24 hours.',
        chargeStatus: 'retry-pending',
      });
    }

    // Second failure — notify customer
    console.log(`\n❌ Charge failed again for +94${phone}. Customer will be notified.\n`);
    return res.status(200).json({
      success: false,
      message: 'Charge failed after retry. Customer notification sent.',
      chargeStatus: 'failed',
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────
// @desc    BSS webhook — bill generated for a customer
// @route   POST /api/payments/webhook/bill-generated
// @access  Internal (BSS billing system only)
// ─────────────────────────────────────────────
export const webhookBillGenerated = async (req, res, next) => {
  const { phone, amount, billReference, description } = req.body;

  if (!phone || !amount) {
    res.status(400);
    return next(new Error('Phone and amount are required from BSS'));
  }

  try {
    console.log(`\n📄 BSS Webhook received — Bill for +94${phone}: LKR ${amount} (Ref: ${billReference})\n`);

    // Check if this phone has an active auto-pay card
    const method = await PaymentMethod.findOne({ phone, isDefault: true, autoPay: true });

    if (!method) {
      console.log(`   No auto-pay card found for +94${phone}. Skipping charge.\n`);
      return res.status(200).json({
        success: true,
        message: 'No auto-pay card found. Manual payment required.',
        charged: false,
      });
    }

    // Trigger charge automatically
    // In production: call payment gateway using method.token and amount
    const chargeSuccess = true; // Replace with real gateway call

    method.lastChargeStatus = chargeSuccess ? 'success' : 'failed';
    method.lastChargeAt = new Date();
    if (!chargeSuccess) method.retryCount += 1;
    else method.retryCount = 0;
    await method.save();

    console.log(`   Auto-charge ${chargeSuccess ? 'SUCCESS' : 'FAILED'} for +94${phone} — LKR ${amount}\n`);

    res.status(200).json({
      success: true,
      message: chargeSuccess
        ? `Auto-charge of LKR ${amount} processed`
        : 'Charge failed. Retry will be attempted.',
      charged: chargeSuccess,
      chargeStatus: method.lastChargeStatus,
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────
// @desc    Create PayHere payment session & security hash
// @route   POST /api/payment/create (or /api/payments/create)
// @access  Public
// ─────────────────────────────────────────────
export const createPayHerePayment = async (req, res, next) => {
  try {
    const { orderId, amount, currency = 'LKR', customerDetails, itemTitle } = req.body;

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
      let appointment = await Appointment.findOne({ orderId: finalOrderId });
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
        } else {
          await Appointment.create({
            orderId: finalOrderId,
            amount: parseFloat(formattedAmount),
            currency: String(currency).toUpperCase(),
            customerName: customerDetails?.name || customerDetails?.firstName || '',
            email: customerDetails?.email || '',
            phone: customerDetails?.phone || '',
            serviceType: itemTitle || 'appointment-booking',
            paymentStatus: 'pending',
            status: 'pending payment',
          });
        }
      } else {
        appointment.amount = parseFloat(formattedAmount);
        appointment.paymentStatus = 'pending';
        appointment.status = 'pending payment';
        await appointment.save();
      }
    } else {
      console.warn('⚠️ MongoDB is not connected. Generating PayHere hash without DB persistence.');
    }

    console.log(`\n💳 PayHere payment hash created: Order ${finalOrderId} | Amount: ${currency} ${formattedAmount}`);
    console.log(`   merchant_id: ${merchantId} | hash: ${hash}\n`);

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const basePath = (process.env.FRONTEND_BASE_PATH || '/Paperlessbackup/').replace(/\/$/, '');
    const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 5050}`;

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

      if (mongoose.connection.readyState === 1) {
        // 1. Update Appointment
        const appointment = await Appointment.findOne({ orderId: order_id });
        if (appointment) {
          appointment.paymentStatus = 'paid';
          appointment.status = 'confirmed';
          appointment.payherePaymentId = paymentId;
          appointment.paidAt = new Date();
          await appointment.save();
          console.log(`   Updated Appointment ${order_id}: paymentStatus=paid, status=confirmed`);
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
          application.paymentDetails.paidAt = new Date();
          await application.save();
          console.log(`   Updated Application ${application.referenceNumber}: paymentStatus=paid, status=confirmed`);
        }
      } else {
        console.warn('⚠️ MongoDB is not connected. Signature verified successfully.');
      }

      return res.status(200).send('OK');
    } else {
      console.warn(`\n⚠️ PayHere Payment non-success status (${status_code}) for Order ${order_id}`);

      const failureStatus = statusCodeStr === '0' ? 'pending' : 'failed';

      if (mongoose.connection.readyState === 1) {
        const appointment = await Appointment.findOne({ orderId: order_id });
        if (appointment) {
          appointment.paymentStatus = failureStatus;
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
    const appointment = await Appointment.findOne({ orderId }).select('orderId paymentStatus');
    if (appointment) {
      return res.status(200).json({
        success: true,
        referenceNumber: appointment.orderId,
        paymentStatus: appointment.paymentStatus,
      });
    }

    // 3. Nothing found — return orderId as the reference
    return res.status(200).json({ success: false, referenceNumber: orderId });
  } catch (error) {
    next(error);
  }
};
