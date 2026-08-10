import * as productService from '../services/productService.js';
import { successResponse, paginatedResponse } from '../utils/responseHandler.js';

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

    const { products, pagination } = await productService.getAllProducts(options);

    return paginatedResponse(
      res,
      'Products retrieved successfully',
      products,
      pagination
    );
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get products by category
 * @route   GET /api/products/category/:category
 * @access  Public
 */
export const getProductsByCategory = async (req, res, next) => {
  try {
    const { category } = req.params;
    const products = await productService.getProductsByCategory(category);
    return successResponse(res, `Products in ${category} retrieved successfully`, products);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Search products by criteria
 * @route   GET /api/products/search
 * @access  Public
 */
export const searchProducts = async (req, res, next) => {
  try {
    const params = {
      category: req.query.category,
      speed: req.query.speed,
      price: req.query.price,
      maxPrice: req.query.maxPrice,
      keyword: req.query.keyword || req.query.search,
    };
    const products = await productService.searchProducts(params);
    return successResponse(res, 'Search results retrieved successfully', products);
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
 * @desc    Get a single product by product code
 * @route   GET /api/products/code/:code
 * @access  Public
 */
export const getProductByCode = async (req, res, next) => {
  try {
    const { code } = req.params;

    const product = await productService.getProductByCode(code);

    return successResponse(res, 'Product retrieved successfully', product);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a new product (Admin only)
 * @route   POST /api/products
 * @access  Private/Admin
 */
export const createProduct = async (req, res, next) => {
  try {
    const productData = req.body;

    const product = await productService.createProduct(productData);

    return successResponse(res, 'Product created successfully', product, 201);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a product (Admin only)
 * @route   PUT /api/products/:id
 * @access  Private/Admin
 */
export const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const product = await productService.updateProduct(id, updateData);

    return successResponse(res, 'Product updated successfully', product);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a product (Admin only)
 * @route   DELETE /api/products/:id
 * @access  Private/Admin
 */
export const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;

    await productService.deleteProduct(id);

    return successResponse(res, 'Product deleted successfully', {});
  } catch (error) {
    next(error);
  }
};

export default {
  getAllProducts,
  getProductsByCategory,
  searchProducts,
  getProductById,
  getProductByCode,
  createProduct,
  updateProduct,
  deleteProduct,
};

