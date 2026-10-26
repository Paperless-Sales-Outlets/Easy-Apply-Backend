import jwt from 'jsonwebtoken';
import Customer from '../models/Customer.js';
import User from '../models/User.js';

// Resolve a token's account id to a staff User or a Customer. `role` is the
// role recorded in the token (if any) and only decides which collection is
// tried first.
export const findAccountById = async (id, role) => {
  const order = role === 'Customer' ? [Customer, User] : [User, Customer];
  for (const Model of order) {
    const account = await Model.findById(id);
    if (account) return account;
  }
  return null;
};

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

      // Admin and staff accounts live in `users`, customers in `customers`.
      // The token carries the role, so look in the matching collection first
      // and fall back to the other for tokens issued before the split.
      const account = await findAccountById(decoded.id, decoded.role);

      if (!account) {
        res.status(401);
        return next(new Error('User account not found'));
      }

      if (account.isActive === false) {
        res.status(403);
        return next(new Error('This account has been deactivated. Contact an administrator.'));
      }

      req.user = account;
      if (account instanceof Customer) req.customer = account;

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
