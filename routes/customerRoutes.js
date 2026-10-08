import express from 'express';
import {
  lookupCustomer,
  getCustomerByTelephone,
  checkCustomerPhone,
  getCustomerProfile,
  updateCustomerProfile,
  syncCustomerOcr,
} from '../controllers/customerController.js';

const router = express.Router();

// @route   POST /api/customers/check-phone
// @desc    Check if a phone number belongs to an existing SLT customer (no PII returned)
// @access  Public
router.post('/check-phone', checkCustomerPhone);

// @route   POST/GET /api/customers/lookup
// @desc    Lookup customer details by telephone/mobile number in REAL database
// @access  Public
router.post('/lookup', lookupCustomer);
router.get('/lookup', lookupCustomer);

// @route   GET /api/customers/profile
// @desc    Get customer profile details
// @access  Public
router.get('/profile', getCustomerProfile);

// @route   PUT /api/customers/profile
// @desc    Update editable customer profile details
// @access  Public
router.put('/profile', updateCustomerProfile);

// @route   POST /api/customers/sync-ocr
// @desc    Sync OCR-extracted KYC data directly to customer DB record
// @access  Public
router.post('/sync-ocr', syncCustomerOcr);

// @route   GET /api/customers/:telephone
// @desc    Lookup customer details by telephone number
// @access  Public
router.get('/:telephone', getCustomerByTelephone);

export default router;
