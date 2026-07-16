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

// Authorize roles (Role-Based Access Control)
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401);
      return next(new Error('Authentication required'));
    }
    if (!roles.includes(req.user.role)) {
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
