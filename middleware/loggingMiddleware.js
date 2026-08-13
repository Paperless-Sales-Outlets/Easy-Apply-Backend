/**
 * Logging middleware for API requests
 * Logs request details including method, URL, timestamp, and response time
 */

/**
 * Request logging middleware
 */
export const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  const { method, originalUrl, ip } = req;
  const userAgent = req.get('user-agent') || 'Unknown';

  // Log request details
  console.log(`[${new Date().toISOString()}] ${method} ${originalUrl} - IP: ${ip} - User-Agent: ${userAgent}`);

  // Capture original json method to log response
  const originalJson = res.json;

  res.json = function (data) {
    const responseTime = Date.now() - startTime;
    const statusCode = res.statusCode;

    console.log(
      `[${new Date().toISOString()}] ${method} ${originalUrl} - Status: ${statusCode} - Response Time: ${responseTime}ms`
    );

    // Log response data for debugging (optional - can be disabled in production)
    if (process.env.NODE_ENV === 'development') {
      console.log('Response Data:', JSON.stringify(data, null, 2));
    }

    return originalJson.call(this, data);
  };

  next();
};

/**
 * Error logging middleware
 */
export const errorLogger = (err, req, res, next) => {
  const { method, originalUrl, ip } = req;
  const timestamp = new Date().toISOString();

  // Use the error's own statusCode first (set by AppError / res.status()),
  // so we log the correct 4xx/5xx even before errorHandler runs.
  const statusCode = err.statusCode || (res.statusCode !== 200 ? res.statusCode : 500);

  console.error(`[${timestamp}] ERROR - ${method} ${originalUrl} - IP: ${ip} - Status: ${statusCode}`);
  console.error('Error Message:', err.message);
  console.error('Error Stack:', err.stack);

  next(err);
};

export default {
  requestLogger,
  errorLogger,
};
