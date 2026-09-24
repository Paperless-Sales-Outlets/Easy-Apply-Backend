import express from 'express';
import * as productController from '../controllers/productController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/products
 * @desc    Get all products with pagination, sorting, and filtering
 * @access  Public
 */
router.get('/', productController.getAllProducts);

/**
 * @route   GET /api/products/search
 * @desc    Search products by category, speed, price, keyword
 * @access  Public
 */
router.get('/search', productController.searchProducts);

/**
 * @route   GET /api/products/category/:category
 * @desc    Get products by category
 * @access  Public
 */
router.get('/category/:category', productController.getProductsByCategory);

/**
 * @route   GET /api/products/code/:code
 * @desc    Get a single product by product code
 * @access  Public
 */
router.get('/code/:code', productController.getProductByCode);

/**
 * @route   GET /api/products/hierarchy
 * @desc    Get Left Sidebar product category tree from Product Hub
 * @access  Public
 */
router.get('/hierarchy', productController.getProductHierarchy);

/**
 * @route   GET /api/products/cart-item/:id
 * @desc    Get product cart item tariff and metadata by ID from Product Hub
 * @access  Public
 */
router.get('/cart-item/:id', productController.getProductCartItem);

/**
 * @route   GET /api/products/:id
 * @desc    Get a single product by ID
 * @access  Public
 */
router.get('/:id', productController.getProductById);

/**
 * @route   GET /api/products/:id/details
 * @desc    Get deep product specs and tables from Product Info Hub
 * @access  Public
 */
router.get('/:id/details', productController.getProductDetails);

/**
 * @route   POST /api/products
 * @desc    Create a new product
 * @access  Private/Admin
 */
router.post(
  '/',
  protect,
  authorize('admin'),
  productController.createProduct
);

/**
 * @route   PUT /api/products/:id
 * @desc    Update a product
 * @access  Private/Admin
 */
router.put(
  '/:id',
  protect,
  authorize('admin'),
  productController.updateProduct
);

/**
 * @route   DELETE /api/products/:id
 * @desc    Delete a product
 * @access  Private/Admin
 */
router.delete(
  '/:id',
  protect,
  authorize('admin'),
  productController.deleteProduct
);

export default router;

