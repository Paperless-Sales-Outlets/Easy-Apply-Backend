import * as cartService from '../services/cartService.js';
import { successResponse } from '../utils/responseHandler.js';

/**
 * Cart Controller
 * Handles all cart-related HTTP requests
 */

/**
 * @desc    Add an item to the cart
 * @route   POST /api/cart/add
 * @access  Private
 */
export const addToCart = async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;
    const userId = req.sessionId;

    const cart = await cartService.addItemToCart(userId, productId, quantity);

    return successResponse(res, 'Product added to cart successfully', cart);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update item quantity in cart
 * @route   PUT /api/cart/update
 * @access  Private
 */
export const updateCart = async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;
    const userId = req.sessionId;

    const cart = await cartService.updateCartItemQuantity(userId, productId, quantity);

    return successResponse(res, 'Cart updated successfully', cart);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Remove an item from cart
 * @route   DELETE /api/cart/remove/:id
 * @access  Private
 */
export const removeFromCart = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.sessionId;

    const cart = await cartService.removeItemFromCart(userId, id);

    return successResponse(res, 'Item removed from cart successfully', cart);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get cart details
 * @route   GET /api/cart
 * @access  Private
 */
export const getCart = async (req, res, next) => {
  try {
    const userId = req.sessionId;

    const cart = await cartService.getCart(userId);

    return successResponse(res, 'Cart retrieved successfully', cart);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Clear the cart
 * @route   DELETE /api/cart/clear
 * @access  Private
 */
export const clearCart = async (req, res, next) => {
  try {
    const userId = req.sessionId;

    const cart = await cartService.clearCart(userId);

    return successResponse(res, 'Cart cleared successfully', cart);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Validate cart for checkout
 * @route   GET /api/cart/validate
 * @access  Private
 */
export const validateCart = async (req, res, next) => {
  try {
    const userId = req.sessionId;

    const cart = await cartService.validateCartForCheckout(userId);

    return successResponse(res, 'Cart validated successfully', cart);
  } catch (error) {
    next(error);
  }
};

export default {
  addToCart,
  updateCart,
  removeFromCart,
  getCart,
  clearCart,
  validateCart,
};
