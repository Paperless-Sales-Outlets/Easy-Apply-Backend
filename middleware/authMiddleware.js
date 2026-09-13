import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// Protect private routes
export const protect = async (req, res, next) => {
  let token;

  // Check authorization header
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Get token from header (format: Bearer <token>)
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

      // Find user and attach to request object
      req.user = await User.findById(decoded.id);

      if (!req.user) {
        res.status(401);
        return next(new Error('User account not found'));
      }

      next();
    } catch (error) {
      res.status(401);
      if (error.name === 'TokenExpiredError') {
        return next(new Error('Access token expired'));
      }
      return next(new Error('Not authorized, token failed'));
    }
  }

  if (!token) {
    res.status(401);
    return next(new Error('Not authorized, no token provided'));
  }
};

export const optionalAuth = async (req, res, next) => {
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      const token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      req.user = await User.findById(decoded.id);
    } catch (error) {
      // Ignore errors for optional auth
    }
  }
  next();
};

// Authorize roles (Role-Based Access Control)
// Roles are matched case-insensitively so 'Admin' / 'Staff' (User model enum)
// also satisfy guards written as 'admin' / 'staff'.
export const authorize = (...roles) => {
  const normalized = roles.map((role) => String(role).toLowerCase());
  return (req, res, next) => {
    if (!req.user) {
      res.status(401);
      return next(new Error('Authentication required'));
    }
    if (!normalized.includes(String(req.user.role).toLowerCase())) {
      res.status(403);
      return next(
        new Error(
          `Access forbidden: User role '${req.user.role}' is not authorized`
        )
      );
    }
    next();
  };
};

export const integrationAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401);
    return next(new Error('Missing integration service token'));
  }

  const token = authHeader.split(' ')[1];
  const validToken = process.env.CONSENTHUB_INTEGRATION_SERVICE_TOKEN;

  if (!validToken) {
    console.error('CONSENTHUB_INTEGRATION_SERVICE_TOKEN is not configured in the environment');
    res.status(500);
    return next(new Error('Integration not configured correctly'));
  }

  if (token !== validToken) {
    res.status(403);
    return next(new Error('Invalid integration service token'));
  }

  next();
};

