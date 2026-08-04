/**
 * Standardized response handler utility
 * Ensures consistent response format across all API endpoints
 */

/**
 * Success response handler
 * @param {Object} res - Express response object
 * @param {String} message - Success message
 * @param {Object} data - Response data
 * @param {Number} statusCode - HTTP status code (default: 200)
 */
export const successResponse = (res, message = 'Success', data = {}, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

/**
 * Error response handler
 * @param {Object} res - Express response object
 * @param {String} message - Error message
 * @param {Object} errors - Validation errors or additional error details
 * @param {Number} statusCode - HTTP status code (default: 500)
 */
export const errorResponse = (res, message = 'Internal server error', errors = null, statusCode = 500) => {
  const response = {
    success: false,
    message,
  };

  if (errors) {
    response.errors = errors;
  }

  return res.status(statusCode).json(response);
};

/**
 * Paginated response handler
 * @param {Object} res - Express response object
 * @param {String} message - Success message
 * @param {Array} data - Response data array
 * @param {Object} pagination - Pagination metadata
 * @param {Number} statusCode - HTTP status code (default: 200)
 */
export const paginatedResponse = (
  res,
  message = 'Success',
  data = [],
  pagination = {},
  statusCode = 200
) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    pagination: {
      page: pagination.page || 1,
      limit: pagination.limit || 10,
      total: pagination.total || 0,
      totalPages: Math.ceil((pagination.total || 0) / (pagination.limit || 10)),
      hasNextPage: (pagination.page || 1) < Math.ceil((pagination.total || 0) / (pagination.limit || 10)),
      hasPrevPage: (pagination.page || 1) > 1,
    },
  });
};

export default {
  successResponse,
  errorResponse,
  paginatedResponse,
};
