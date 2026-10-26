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
  const target = String(productId);
  const existingItem = cart.items.find(
    (item) =>
      (item.productId && item.productId.toString() === target) ||
      (item._id && item._id.toString() === target) ||
      (item.id && item.id.toString() === target)
  );

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
    await cart.updateItemQuantity(target, newQuantity);
  } else {
    // Add new item
    await cart.addItem(product, quantity);
  }

  return await Cart.findOne({ userId }).lean();
};

/**
 * Remove item from cart
 */
export const removeItemFromCart = async (userId, productId) => {
  // Get cart — must be a real document, see updateCartItemQuantity above.
  const cart = await getOrCreateCart(userId);
  const target = String(productId);

  // Remove item (idempotent, checks productId, _id, or id without throwing 500)
  await cart.removeItem(target);

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
