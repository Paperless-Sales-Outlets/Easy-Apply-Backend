/**
 * Cart Module Index
 * Exports all cart-related modules for easy importing
 */

// Models
export { default as Product } from './models/Product.js';
export { default as Cart } from './models/Cart.js';

// Controllers
export * from './controllers/productController.js';
export * from './controllers/cartController.js';

// Services
export * as productService from './services/productService.js';
export * as cartService from './services/cartService.js';

// Routes
export { default as productRoutes } from './routes/productRoutes.js';
export { default as cartRoutes } from './routes/cartRoutes.js';

// Validators
export * from './validators/cartValidators.js';

// Middleware
export { requestLogger, errorLogger } from './middleware/loggingMiddleware.js';
export { protect, authorize } from './middleware/authMiddleware.js';
export { AppError, errorHandler, notFound } from './middleware/errorHandler.js';

// Utils
export { successResponse, errorResponse, paginatedResponse } from './utils/responseHandler.js';
