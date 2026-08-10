import Product from '../models/Product.js';
import mongoose from 'mongoose';

/**
 * Product Service Layer
 * Handles all product-related business logic
 */

/**
 * Get all products with pagination, sorting, and filtering
 */
export const getAllProducts = async (options = {}) => {
  const {
    page = 1,
    limit = 50,
    category,
    status = 'active',
    sortBy = 'createdAt',
    sortOrder = 'desc',
    search,
    speed,
    maxPrice,
  } = options;

  const query = {};

  if (status && status !== 'all') {
    query.status = status;
  }

  if (category && category !== 'All Products') {
    query.category = { $regex: new RegExp(`^${category.replace('-', ' ')}`, 'i') };
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } },
      { speed: { $regex: search, $options: 'i' } },
    ];
  }

  if (maxPrice) {
    query.monthlyPrice = { $lte: Number(maxPrice) };
  }

  const skip = (page - 1) * limit;
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  const [products, total] = await Promise.all([
    Product.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    Product.countDocuments(query),
  ]);

  return {
    products,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
    },
  };
};

/**
 * Get products by category
 */
export const getProductsByCategory = async (category) => {
  const query = { status: 'active' };
  if (category && category !== 'All Products') {
    const formattedCategory = category.replace('-', ' ');
    query.category = { $regex: new RegExp(`^${formattedCategory}`, 'i') };
  }
  const products = await Product.find(query).lean();
  return products;
};

/**
 * Search products supporting category, speed, price, and keyword
 */
export const searchProducts = async (params = {}) => {
  const { category, speed, price, keyword, maxPrice } = params;
  const query = { status: 'active' };

  if (category && category !== 'All Products') {
    query.category = { $regex: new RegExp(`^${category.replace('-', ' ')}`, 'i') };
  }

  if (keyword) {
    query.$or = [
      { name: { $regex: keyword, $options: 'i' } },
      { description: { $regex: keyword, $options: 'i' } },
      { speed: { $regex: keyword, $options: 'i' } },
    ];
  }

  if (speed) {
    query.speed = { $regex: speed, $options: 'i' };
  }

  const targetPrice = price || maxPrice;
  if (targetPrice) {
    query.monthlyPrice = { $lte: Number(targetPrice) };
  }

  const products = await Product.find(query).lean();
  return products;
};

/**
 * Get a single product by ID
 */
export const getProductById = async (id) => {
  let product = null;
  if (mongoose.Types.ObjectId.isValid(id)) {
    product = await Product.findById(id).lean();
  }
  if (!product) {
    product = await Product.findOne({ productId: id }).lean();
  }
  if (!product) {
    throw new Error('Product not found');
  }
  return product;
};

/**
 * Get a single product by product code
 */
export const getProductByCode = async (productCode) => {
  const product = await Product.findOne({ productCode }).lean();

  if (!product) {
    throw new Error('Product not found');
  }

  return product;
};

/**
 * Check if product exists and has sufficient stock
 */
export const checkProductAvailability = async (productId, quantity) => {
  let product = null;
  if (mongoose.Types.ObjectId.isValid(productId)) {
    product = await Product.findById(productId);
  }
  if (!product) {
    product = await Product.findOne({ productId });
  }

  if (!product) {
    throw new Error('Product not found');
  }

  if (product.status !== 'active') {
    throw new Error('Product is not available');
  }

  return product;
};

/**
 * Create a new product (Admin)
 */
export const createProduct = async (productData) => {
  const product = await Product.create(productData);
  return product;
};

/**
 * Update a product (Admin)
 */
export const updateProduct = async (productId, updateData) => {
  const product = await Product.findByIdAndUpdate(
    productId,
    updateData,
    { new: true, runValidators: true }
  );

  if (!product) {
    throw new Error('Product not found');
  }

  return product;
};

/**
 * Delete a product (Admin)
 */
export const deleteProduct = async (productId) => {
  const product = await Product.findByIdAndDelete(productId);

  if (!product) {
    throw new Error('Product not found');
  }

  return product;
};

export default {
  getAllProducts,
  getProductsByCategory,
  searchProducts,
  getProductById,
  getProductByCode,
  checkProductAvailability,
  createProduct,
  updateProduct,
  deleteProduct,
};

