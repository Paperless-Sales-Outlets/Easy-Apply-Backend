import PaymentMethod from '../models/PaymentMethod.js';

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
