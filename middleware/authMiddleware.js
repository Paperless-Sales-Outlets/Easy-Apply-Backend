import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// ─────────────────────────────────────────────────────────────────────────────
// ROLE CONSTANTS
// Single source of truth for all valid roles in the system.
// Import these anywhere you need to reference roles by name.
// ─────────────────────────────────────────────────────────────────────────────
export const ROLES = Object.freeze({
  CUSTOMER:          'Customer',
  STAFF:             'Staff',
  ADMIN:             'Admin',
  FIELD_TECHNICIAN:  'FieldTechnician',
});

// ─────────────────────────────────────────────────────────────────────────────
// ROLE GROUPS
// Pre-defined combinations of roles used across multiple routes.
// ─────────────────────────────────────────────────────────────────────────────
export const ROLE_GROUPS = Object.freeze({
  // All internal SLT staff (no customer access)
  INTERNAL_STAFF: [ROLES.STAFF, ROLES.ADMIN, ROLES.FIELD_TECHNICIAN],

  // Roles that can view & manage applications in the admin panel
  APPLICATION_MANAGERS: [ROLES.STAFF, ROLES.ADMIN],

  // Only the system administrator
  ADMIN_ONLY: [ROLES.ADMIN],

  // All authenticated users (every role)
  ALL_AUTHENTICATED: [ROLES.CUSTOMER, ROLES.STAFF, ROLES.ADMIN, ROLES.FIELD_TECHNICIAN],
});

// ─────────────────────────────────────────────────────────────────────────────
// PROTECT MIDDLEWARE
// Verifies the Bearer JWT token and attaches the user to req.user.
// Must be applied BEFORE any authorize() call.
// ─────────────────────────────────────────────────────────────────────────────
export const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];

      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

      // Attach user to request (exclude password field)
      req.user = await User.findById(decoded.id).select('-password');

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

// ─────────────────────────────────────────────────────────────────────────────
// AUTHORIZE MIDDLEWARE
// Role-Based Access Control (RBAC) guard.
// Pass one or more allowed roles (or spread a ROLE_GROUPS array).
//
// Usage examples:
//   router.get('/admin', protect, authorize('Admin'), handler);
//   router.get('/staff', protect, authorize(...ROLE_GROUPS.INTERNAL_STAFF), handler);
//   router.get('/manage', protect, authorize('Staff', 'Admin'), handler);
// ─────────────────────────────────────────────────────────────────────────────
export const authorize = (...roles) => {
  // Flatten in case a ROLE_GROUPS array was spread and then wrapped in another array
  const allowedRoles = roles.flat();

  return (req, res, next) => {
    if (!req.user) {
      res.status(401);
      return next(new Error('Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403);
      return next(
        new Error(
          `Access forbidden: role '${req.user.role}' is not permitted. ` +
          `Required: [${allowedRoles.join(', ')}]`
        )
      );
    }

    next();
  };
};
