import express from 'express';
import * as cartController from '../controllers/cartController.js';
import {
  validateAddToCart,
  validateUpdateCart,
  validateRemoveFromCart,
  handleValidationErrors,
} from '../validators/cartValidators.js';
import { sessionMiddleware } from '../middleware/sessionMiddleware.js';

const router = express.Router();

// All cart routes use sessionMiddleware (no login required)
// The frontend sends x-session-id header; server echoes it back.

/**
 * @route   POST /api/cart/add
 * @desc    Add an item to the cart
 * @access  Public (session-based)
 */
router.post(
  '/add',
  sessionMiddleware,
  validateAddToCart,
  handleValidationErrors,
  cartController.addToCart
);

/**
 * @route   PUT /api/cart/update
 * @desc    Update item quantity in cart
 * @access  Public (session-based)
 */
router.put(
  '/update',
  sessionMiddleware,
  validateUpdateCart,
  handleValidationErrors,
  cartController.updateCart
);

/**
 * @route   DELETE /api/cart/remove/:id
 * @desc    Remove an item from cart
 * @access  Public (session-based)
 */
router.delete(
  '/remove/:id',
  sessionMiddleware,
  validateRemoveFromCart,
  handleValidationErrors,
  cartController.removeFromCart
);

/**
 * @route   GET /api/cart
 * @desc    Get cart details
 * @access  Public (session-based)
 */
router.get('/', sessionMiddleware, cartController.getCart);

/**
 * @route   DELETE /api/cart/clear
 * @desc    Clear the cart
 * @access  Public (session-based)
 */
router.delete('/clear', sessionMiddleware, cartController.clearCart);

/**
 * @route   GET /api/cart/validate
 * @desc    Validate cart for checkout
 * @access  Public (session-based)
 */
router.get('/validate', sessionMiddleware, cartController.validateCart);

export default router;
