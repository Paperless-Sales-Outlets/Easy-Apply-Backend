import Product from '../models/Product.js';

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
    limit = 10,
    category,
    status = 'active',
    sortBy = 'createdAt',
    sortOrder = 'desc',
    search,
  } = options;

  // Build query
  const query = {};

  // Filter by category
  if (category) {
    query.category = category;
  }

  // Filter by status
  if (status) {
    query.status = status;
  }

  // Search functionality
  if (search) {
    query.$or = [
      { productName: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { productCode: { $regex: search, $options: 'i' } },
    ];
  }

  // Calculate skip value for pagination
  const skip = (page - 1) * limit;

  // Build sort object
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  // Execute query with pagination and sorting
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
 * Get a single product by ID
 */
export const getProductById = async (productId) => {
  const product = await Product.findOne({ productId }).lean();

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
  const product = await Product.findOne({ productId });

  if (!product) {
    throw new Error('Product not found');
  }

  if (product.status !== 'active') {
    throw new Error('Product is not available');
  }

  if (product.availableQuantity < quantity) {
    throw new Error(`Insufficient stock. Only ${product.availableQuantity} available`);
  }

  return product;
};

/**
 * Decrease product stock
 */
export const decreaseProductStock = async (productId, quantity) => {
  const product = await Product.findOne({ productId });

  if (!product) {
    throw new Error('Product not found');
  }

  await product.decreaseStock(quantity);
  return product;
};

/**
 * Increase product stock
 */
export const increaseProductStock = async (productId, quantity) => {
  const product = await Product.findOne({ productId });

  if (!product) {
    throw new Error('Product not found');
  }

  await product.increaseStock(quantity);
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
  const product = await Product.findOneAndUpdate(
    { productId },
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
  const product = await Product.findOneAndDelete({ productId });

  if (!product) {
    throw new Error('Product not found');
  }

  return product;
};

export default {
  getAllProducts,
  getProductById,
  getProductByCode,
  checkProductAvailability,
  decreaseProductStock,
  increaseProductStock,
  createProduct,
  updateProduct,
  deleteProduct,
};
