import express from 'express';
import * as productController from '../controllers/productController.js';
import {
  validateGetProducts,
  validateGetProduct,
  handleValidationErrors,
} from '../validators/cartValidators.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/products
 * @desc    Get all products with pagination, sorting, and filtering
 * @access  Public
 */
router.get(
  '/',
  validateGetProducts,
  handleValidationErrors,
  productController.getAllProducts
);

/**
 * @route   GET /api/products/:id
 * @desc    Get a single product by ID
 * @access  Public
 */
router.get(
  '/:id',
  validateGetProduct,
  handleValidationErrors,
  productController.getProductById
);

/**
 * @route   GET /api/products/code/:code
 * @desc    Get a single product by product code
 * @access  Public
 */
router.get(
  '/code/:code',
  productController.getProductByCode
);

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
