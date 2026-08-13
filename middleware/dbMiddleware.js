import { isDbConnected } from '../config/db.js';

// Short-circuit admin data routes with a clear 503 when the database is
// unavailable, instead of letting buffered queries time out into a 500.
export const requireDb = (req, res, next) => {
  if (!isDbConnected()) {
    return res.status(503).json({
      success: false,
      message: 'Database temporarily unavailable — please try again shortly.',
    });
  }
  next();
};
