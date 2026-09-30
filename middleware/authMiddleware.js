import jwt from 'jsonwebtoken';
import Customer, { User } from '../models/Customer.js';

// Protect private routes
export const protect = async (req, res, next) => {
  let token;

  // Check authorization header or query token (for img / file streaming)
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (token) {
    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

      // Find customer and attach to request object
      const customer = await Customer.findById(decoded.id);

      if (!customer) {
        res.status(401);
        return next(new Error('Customer account not found'));
      }

      req.customer = customer;
      req.user = customer; // backward compatibility

      return next();
    } catch (error) {
      res.status(401);
      if (error.name === 'TokenExpiredError') {
        return next(new Error('Access token expired'));
      }
      return next(new Error('Not authorized, token failed'));
    }
  }

  res.status(401);
  return next(new Error('Not authorized, no token provided'));
};

// Authorize roles (Role-Based Access Control)
// Roles are matched case-insensitively so 'Admin' / 'Staff' (Customer model enum)
// also satisfy guards written as 'admin' / 'staff'.
export const authorize = (...roles) => {
  const normalized = roles.map((role) => String(role).toLowerCase());
  return (req, res, next) => {
    const userObj = req.customer || req.user;
    if (!userObj) {
      res.status(401);
      return next(new Error('Authentication required'));
    }
    if (!normalized.includes(String(userObj.role).toLowerCase())) {
      res.status(403);
      return next(
        new Error(
          `Access forbidden: User role '${userObj.role}' is not authorized`
        )
      );
    }
    next();
  };
};
