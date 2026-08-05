import crypto from 'crypto';

/**
 * Session middleware for guest/unauthenticated cart access.
 * 
 * Reads `x-session-id` header from the request.
 * If not present, generates a new UUID session ID and attaches it.
 * Sets req.sessionId so cart controllers can use it instead of req.user._id
 */
export const sessionMiddleware = (req, res, next) => {
  const sessionId = req.headers['x-session-id'] || crypto.randomUUID();
  req.sessionId = sessionId;
  // Echo the session ID back so the client can persist it
  res.setHeader('x-session-id', sessionId);
  next();
};

