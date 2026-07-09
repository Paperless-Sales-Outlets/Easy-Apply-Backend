export const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log to console for development
  console.error(err);

  let statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;

  // Mongoose duplicate key (e.g. unique email or NIC check)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const displayField = field === 'NIC' ? 'NIC / Passport / BR Number' : field;
    error.message = `${displayField.charAt(0).toUpperCase() + displayField.slice(1)} is already registered`;
    statusCode = 400;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    error.message = Object.values(err.errors).map((val) => val.message).join(', ');
    statusCode = 400;
  }

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    error.message = 'Resource not found';
    statusCode = 404;
  }

  res.status(statusCode).json({
    success: false,
    message: error.message || 'Server Error',
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
};
