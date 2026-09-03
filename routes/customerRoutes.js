import express from 'express';
import { lookupCustomer, getCustomerByTelephone } from '../controllers/customerController.js';

const router = express.Router();

// @route   POST /api/customers/lookup
// @desc    Lookup customer details by telephone/mobile number in REAL database
// @access  Public
router.post('/lookup', lookupCustomer);
router.get('/lookup', lookupCustomer);

// @route   GET /api/customers/:telephone
// @desc    Lookup customer details by telephone number
// @access  Public
router.get('/:telephone', getCustomerByTelephone);

export default router;
