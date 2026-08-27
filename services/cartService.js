import Cart from '../models/Cart.js';
import * as productService from './productService.js';

/**
 * Cart Service Layer
 * Handles all cart-related business logic
 */

/**
 * Get or create cart for a user
 */
export const getOrCreateCart = async (userId) => {
  let cart = await Cart.findOne({ userId });

  if (!cart) {
    cart = await Cart.create({
      userId,
      items: [],
      totalAmount: 0,
    });
  }

  return cart;
};

/**
 * Get cart details for a user
 */
export const getCart = async (userId) => {
  const cart = await Cart.findOne({ userId }).lean();

  if (!cart) {
    // Return a virtual empty cart — don't throw for unauthenticated/new sessions
    return { userId, items: [], totalAmount: 0 };
  }

  return cart;
};

/**
 * Add item to cart
 */
export const addItemToCart = async (userId, productId, quantity) => {
  // Validate quantity
  if (quantity <= 0) {
    throw new Error('Quantity must be greater than zero');
  }

  // Check product availability
  const product = await productService.checkProductAvailability(productId, quantity);

  // Get or create cart
  const cart = await getOrCreateCart(userId);

  // Check if item already exists in cart
  const existingItem = cart.items.find((item) => item.productId === productId);

  if (existingItem) {
    // Calculate new total quantity
    const newQuantity = existingItem.quantity + quantity;

    // Check if new quantity exceeds available stock
    if (newQuantity > product.availableQuantity) {
      throw new Error(
        `Cannot add ${quantity} more items. Total quantity (${newQuantity}) exceeds available stock (${product.availableQuantity})`
      );
    }

    // Update existing item
    await cart.updateItemQuantity(productId, newQuantity);
  } else {
    // Add new item
    await cart.addItem(product, quantity);
  }

  return await Cart.findOne({ userId }).lean();
};

/**
 * Update item quantity in cart
 */
export const updateCartItemQuantity = async (userId, productId, quantity) => {
  // Validate quantity
  if (quantity <= 0) {
    throw new Error('Quantity must be greater than zero');
  }

  // Get cart — must be a real document (not getCart's .lean() result) since
  // updateItemQuantity below is a Mongoose instance method.
  const cart = await getOrCreateCart(userId);

  // Check if item exists in cart
  const existingItem = cart.items.find((item) => item.productId === productId);

  if (!existingItem) {
    throw new Error('Item not found in cart');
  }

  // Check product availability
  const product = await productService.checkProductAvailability(productId, quantity);

  // Update quantity
  await cart.updateItemQuantity(productId, quantity);

  return await Cart.findOne({ userId }).lean();
};

/**
 * Remove item from cart
 */
export const removeItemFromCart = async (userId, productId) => {
  // Get cart — must be a real document, see updateCartItemQuantity above.
  const cart = await getOrCreateCart(userId);

  // Check if item exists in cart
  const existingItem = cart.items.find((item) => item.productId === productId);

  if (!existingItem) {
    throw new Error('Item not found in cart');
  }

  // Remove item
  await cart.removeItem(productId);

  return await Cart.findOne({ userId }).lean();
};

/**
 * Clear cart
 */
export const clearCart = async (userId) => {
  // Must be a real document, see updateCartItemQuantity above.
  const cart = await getOrCreateCart(userId);

  await cart.clearCart();

  return await Cart.findOne({ userId }).lean();
};

/**
 * Validate cart items before checkout
 */
export const validateCartForCheckout = async (userId) => {
  const cart = await getCart(userId);

  if (cart.items.length === 0) {
    throw new Error('Cart is empty');
  }

  // Check each item for availability and stock
  for (const item of cart.items) {
    try {
      await productService.checkProductAvailability(item.productId, item.quantity);
    } catch (error) {
      throw new Error(
        `Product "${item.productName}" is not available or has insufficient stock`
      );
    }
  }

  return cart;
};

/**
 * Decrease stock for cart items after successful payment
 */
export const decreaseStockForCartItems = async (userId) => {
  const cart = await getCart(userId);

  for (const item of cart.items) {
    await productService.decreaseProductStock(item.productId, item.quantity);
  }

  return cart;
};

/**
 * Increase stock for cart items (e.g., after payment failure)
 */
export const increaseStockForCartItems = async (userId) => {
  const cart = await getCart(userId);

  for (const item of cart.items) {
    await productService.increaseProductStock(item.productId, item.quantity);
  }

  return cart;
};

export default {
  getOrCreateCart,
  getCart,
  addItemToCart,
  updateCartItemQuantity,
  removeItemFromCart,
  clearCart,
  validateCartForCheckout,
  decreaseStockForCartItems,
  increaseStockForCartItems,
};
