import * as productService from '../services/productService.js';
import { successResponse } from '../utils/responseHandler.js';

/**
 * Product Controller
 * Handles all product-related HTTP requests
 */

/**
 * @desc    Get all products with pagination, sorting, and filtering
 * @route   GET /api/products
 * @access  Public
 */
export const getAllProducts = async (req, res, next) => {
  try {
    const options = {
      page: req.query.page,
      limit: req.query.limit,
      category: req.query.category,
      status: req.query.status,
      sortBy: req.query.sortBy,
      sortOrder: req.query.sortOrder,
      search: req.query.search || req.query.keyword,
      speed: req.query.speed,
      maxPrice: req.query.maxPrice || req.query.price,
    };

    const { products, pagination, source, hubUrl } = await productService.getAllProducts(options);

    return res.status(200).json({
      success: true,
      message: 'Products retrieved successfully',
      data: products,
      source: source || 'LOCAL_DATABASE',
      hubUrl: hubUrl || process.env.PRODUCT_HUB_URL || process.env.REACT_APP_PRODUCT_HUB_URL || 'https://dpdlab1.slt.lk:703/api/templates',
      pagination: {
        page: pagination.page || 1,
        limit: pagination.limit || 10,
        total: pagination.total || 0,
        totalPages: Math.ceil((pagination.total || 0) / (pagination.limit || 10)),
        hasNextPage: (pagination.page || 1) < Math.ceil((pagination.total || 0) / (pagination.limit || 10)),
        hasPrevPage: (pagination.page || 1) > 1,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single product by ID
 * @route   GET /api/products/:id
 * @access  Public
 */
export const getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const product = await productService.getProductById(id);

    return successResponse(res, 'Product retrieved successfully', product);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get detailed product specifications, fixed fields, and tables from Product Info Hub
 * @route   GET /api/products/:id/details
 * @access  Public
 */
export const getProductDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const details = await productService.getProductDetails(id);
    return res.status(200).json(details);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get product category hierarchy tree from Product Hub
 * @route   GET /api/products/hierarchy
 * @access  Public
 */
export const getProductHierarchy = async (req, res, next) => {
  try {
    const hierarchy = await productService.fetchProductHierarchy();
    return successResponse(res, 'Product hierarchy retrieved successfully', hierarchy);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get product cart item by ID from Product Hub
 * @route   GET /api/products/cart-item/:id
 * @access  Public
 */
export const getProductCartItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const cartItem = await productService.fetchProductCartItem(id);
    if (!cartItem) {
      return res.status(404).json({
        success: false,
        message: 'Cart product not found in Product Hub',
      });
    }
    return successResponse(res, 'Cart product retrieved successfully', cartItem);
  } catch (error) {
    next(error);
  }
};
