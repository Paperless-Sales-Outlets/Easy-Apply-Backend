import crypto from 'crypto';

/**
 * Formats amount to 2 decimal places as required by PayHere (e.g., 1000 -> "1000.00")
 * @param {number|string} amount
 * @returns {string}
 */
export const formatPayHereAmount = (amount) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return '0.00';
  return num.toFixed(2);
};

/**
 * Generates MD5 hash for PayHere Checkout initialization.
 * Formula: MD5(merchant_id + order_id + amountFormatted + currency + UPPERCASE(MD5(merchant_secret)))
 *
 * @param {string} merchantId
 * @param {string} orderId
 * @param {number|string} amount
 * @param {string} currency
 * @param {string} merchantSecret
 * @returns {string} Uppercase MD5 hash
 */
export const generatePayHereHash = (
  merchantId,
  orderId,
  amount,
  currency = 'LKR',
  merchantSecret
) => {
  if (!merchantId || !orderId || amount === undefined || !merchantSecret) {
    throw new Error('Missing required parameters for PayHere hash generation');
  }

  const formattedAmount = formatPayHereAmount(amount);
  const currencyUpper = String(currency).toUpperCase();

  // 1. Hash the merchant secret and uppercase it
  const hashedSecret = crypto
    .createHash('md5')
    .update(merchantSecret)
    .digest('hex')
    .toUpperCase();

  // 2. Concatenate: merchant_id + order_id + amountFormatted + currency + hashedSecret
  const hashString =
    String(merchantId) +
    String(orderId) +
    formattedAmount +
    currencyUpper +
    hashedSecret;

  // 3. Hash the concatenated string and uppercase it
  return crypto
    .createHash('md5')
    .update(hashString)
    .digest('hex')
    .toUpperCase();
};

/**
 * Verifies PayHere IPN notification callback md5sig signature.
 * Formula: MD5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + UPPERCASE(MD5(merchant_secret)))
 *
 * @param {Object} data - PayHere notification body params
 * @param {string} merchantSecret
 * @returns {boolean} True if signature is valid
 */
export const verifyPayHereNotifyHash = (data = {}, merchantSecret) => {
  const {
    merchant_id,
    order_id,
    payhere_amount,
    payhere_currency,
    status_code,
    md5sig,
  } = data;

  if (
    !merchant_id ||
    !order_id ||
    payhere_amount === undefined ||
    !payhere_currency ||
    status_code === undefined ||
    !md5sig ||
    !merchantSecret
  ) {
    return false;
  }

  const formattedAmount = formatPayHereAmount(payhere_amount);
  const currencyUpper = String(payhere_currency).toUpperCase();

  const hashedSecret = crypto
    .createHash('md5')
    .update(merchantSecret)
    .digest('hex')
    .toUpperCase();

  const hashString =
    String(merchant_id) +
    String(order_id) +
    formattedAmount +
    currencyUpper +
    String(status_code) +
    hashedSecret;

  const expectedSig = crypto
    .createHash('md5')
    .update(hashString)
    .digest('hex')
    .toUpperCase();

  return expectedSig === String(md5sig).toUpperCase();
};
