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

/**
 * @route   DELETE /api/cart/clear
 * @desc    Clear the cart
 * @access  Public (session-based)
 *
 * Registered before the /:id route below — Express matches routes in
 * registration order, so with /:id first, a request to /cart/clear would
 * match it with id='clear' instead of reaching this handler, then 500
 * with "Item not found in cart" since no item has that product id.
 */
router.delete('/clear', cartController.clearCart);

/**
 * @route   DELETE /api/cart/:id
 * @desc    Remove an item from cart
 * @access  Public (session-based)
 */
router.delete('/:id', cartController.removeFromCart);

export default router;

