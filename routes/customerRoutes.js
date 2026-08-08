import express from 'express';
import { getCustomerByTelephone } from '../controllers/customerController.js';

const router = express.Router();

// @route   GET /api/customers/:telephone
// @desc    Lookup customer details by telephone number
// @access  Public
router.get('/:telephone', getCustomerByTelephone);

export default router;
