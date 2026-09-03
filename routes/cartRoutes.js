import express from 'express';
import * as cartController from '../controllers/cartController.js';
import { sessionMiddleware } from '../middleware/sessionMiddleware.js';

const router = express.Router();

// All cart routes use sessionMiddleware (no login required)
router.use(sessionMiddleware);

/**
 * @route   GET /api/cart
 * @desc    Get cart details
 * @access  Public (session-based)
 */
router.get('/', cartController.getCart);

/**
 * @route   POST /api/cart
 * @desc    Add an item to the cart
 * @access  Public (session-based)
 */
router.post('/', cartController.addToCart);
router.post('/add', cartController.addToCart);

/**
 * @route   PUT /api/cart/update
 * @desc    Update item quantity in cart
 * @access  Public (session-based)
 */
router.put('/update', cartController.updateCart);

/**
 * @route   DELETE /api/cart/:id
 * @desc    Remove an item from cart
 * @access  Public (session-based)
 */
router.delete('/:id', cartController.removeFromCart);
router.delete('/remove/:id', cartController.removeFromCart);

/**
 * @route   DELETE /api/cart/clear
 * @desc    Clear the cart
 * @access  Public (session-based)
 */
router.delete('/clear', cartController.clearCart);

/**
 * @route   GET /api/cart/validate
 * @desc    Validate cart for checkout
 * @access  Public (session-based)
 */
router.get('/validate', cartController.validateCart);

export default router;

