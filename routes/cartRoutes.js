import express from 'express';
import * as cartController from '../controllers/cartController.js';
import {
  validateAddToCart,
  validateUpdateCart,
  validateRemoveFromCart,
  handleValidationErrors,
} from '../validators/cartValidators.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   POST /api/cart/add
 * @desc    Add an item to the cart
 * @access  Private
 */
router.post(
  '/add',
  protect,
  validateAddToCart,
  handleValidationErrors,
  cartController.addToCart
);

/**
 * @route   PUT /api/cart/update
 * @desc    Update item quantity in cart
 * @access  Private
 */
router.put(
  '/update',
  protect,
  validateUpdateCart,
  handleValidationErrors,
  cartController.updateCart
);

/**
 * @route   DELETE /api/cart/remove/:id
 * @desc    Remove an item from cart
 * @access  Private
 */
router.delete(
  '/remove/:id',
  protect,
  validateRemoveFromCart,
  handleValidationErrors,
  cartController.removeFromCart
);

/**
 * @route   GET /api/cart
 * @desc    Get cart details
 * @access  Private
 */
router.get('/', protect, cartController.getCart);

/**
 * @route   DELETE /api/cart/clear
 * @desc    Clear the cart
 * @access  Private
 */
router.delete('/clear', protect, cartController.clearCart);

/**
 * @route   GET /api/cart/validate
 * @desc    Validate cart for checkout
 * @access  Private
 */
router.get('/validate', protect, cartController.validateCart);

export default router;
