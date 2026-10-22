import express from 'express';
import * as productController from '../controllers/productController.js';

const router = express.Router();

/**
 * @route   GET /api/products
 * @desc    Get all products with pagination, sorting, and filtering
 * @access  Public
 */
router.get('/', productController.getAllProducts);

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

export default router;

