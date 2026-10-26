import { verifyDraftToken } from '../utils/draftToken.js';

/**
 * Allow a request only from someone who verified a mobile number by OTP.
 *
 * The token is issued by POST /api/otp/verify and sent in the `x-draft-token`
 * header. The verified number is put on `req.draftPhone`; drafts are always
 * looked up by it, never by a number sent in the request.
 */
export const protectDraft = (req, res, next) => {
  const token = req.headers['x-draft-token'];

  if (!token) {
    res.status(401);
    return next(new Error('Please verify your mobile number to save your application'));
  }

  try {
    req.draftPhone = verifyDraftToken(token);
    return next();
  } catch (error) {
    res.status(401);
    return next(new Error('Your verification has expired. Please sign in again to continue your application'));
  }
};
