import { body, param, query } from 'express-validator';

// Validation rules for adding item to cart
export const validateAddToCart = [
  body('productId')
    .trim()
    .notEmpty()
    .withMessage('Product ID is required')
    .isString()
    .withMessage('Product ID must be a string'),
  body('quantity')
    .notEmpty()
    .withMessage('Quantity is required')
    .isInt({ gt: 0 })
    .withMessage('Quantity must be greater than zero')
    .isInt({ max: 100 })
    .withMessage('Quantity cannot exceed 100'),
];

// Validation rules for updating item quantity
export const validateUpdateCart = [
  body('productId')
    .trim()
    .notEmpty()
    .withMessage('Product ID is required')
    .isString()
    .withMessage('Product ID must be a string'),
  body('quantity')
    .notEmpty()
    .withMessage('Quantity is required')
    .isInt({ gt: 0 })
    .withMessage('Quantity must be greater than zero')
    .isInt({ max: 100 })
    .withMessage('Quantity cannot exceed 100'),
];

// Validation rules for removing item from cart
export const validateRemoveFromCart = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Product ID is required')
    .isString()
    .withMessage('Product ID must be a string'),
];

// Validation rules for getting products with pagination, sorting, and filtering
export const validateGetProducts = [
  query('page')
    .optional()
    .isInt({ gt: 0 })
    .withMessage('Page must be a positive integer')
    .default(1),
  query('limit')
    .optional()
    .isInt({ gt: 0, max: 100 })
    .withMessage('Limit must be between 1 and 100')
    .default(10),
  query('category')
    .optional()
    .isIn(['broadband', 'voice', 'peo-tv', 'accessories', 'devices', 'packages'])
    .withMessage('Invalid category'),
  query('status')
    .optional()
    .isIn(['active', 'inactive', 'out-of-stock'])
    .withMessage('Invalid status'),
  query('sortBy')
    .optional()
    .isIn(['price', 'productName', 'createdAt', 'availableQuantity'])
    .withMessage('Invalid sort field'),
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Invalid sort order'),
  query('search')
    .optional()
    .trim()
    .isString()
    .withMessage('Search term must be a string'),
];

// Validation rules for getting single product
export const validateGetProduct = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Product ID is required')
    .isString()
    .withMessage('Product ID must be a string'),
];

// Validation error handler middleware
export const handleValidationErrors = (req, res, next) => {
  const errors = req.validationErrors();
  if (errors) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.map((err) => ({
        field: err.param,
        message: err.msg,
      })),
    });
  }
  next();
};
