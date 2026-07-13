import mongoose from 'mongoose';

const paymentMethodSchema = new mongoose.Schema(
  {
    // Link this card to the logged-in user
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
    },

    // Token returned by the payment gateway (e.g. Stripe source/card token)
    // Raw card numbers are NEVER stored — token-only approach
    token: {
      type: String,
      required: [true, 'Payment token is required'],
      trim: true,
    },

    // Card brand — e.g. "Visa", "Mastercard"
    cardBrand: {
      type: String,
      required: [true, 'Card brand is required'],
      trim: true,
      enum: ['Visa', 'Mastercard', 'Amex', 'Other'],
    },

    // Last 4 digits of the card — safe to store, used for display only
    last4: {
      type: String,
      required: [true, 'Last 4 digits are required'],
      trim: true,
      minlength: 4,
      maxlength: 4,
    },

    // Card expiry details — for display and expiry checks only
    expiryMonth: {
      type: Number,
      required: [true, 'Expiry month is required'],
      min: 1,
      max: 12,
    },
    expiryYear: {
      type: Number,
      required: [true, 'Expiry year is required'],
      min: new Date().getFullYear(),
    },

    // Whether this is the user's default payment card
    isDefault: {
      type: Boolean,
      default: false,
    },

    // Autopay consent — customer explicitly agreed to recurring charges
    autoPay: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

const PaymentMethod = mongoose.model('PaymentMethod', paymentMethodSchema);

export default PaymentMethod;
