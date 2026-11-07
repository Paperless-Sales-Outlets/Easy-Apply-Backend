import jwt from 'jsonwebtoken';

// Proof that the caller verified a mobile number by OTP, used only to save and
// load that number's unfinished New Connection application. It carries no
// customer id, so `protect` rejects it and it can't stand in for a login token.
const AUDIENCE = 'new-connection-draft';
const DEFAULT_EXPIRY = '30d'; // as long as a draft is kept

/** The 9-digit national number, the form drafts are stored under. */
export const normalizeDraftPhone = (phone) => String(phone || '').replace(/\D/g, '').slice(-9);

export const issueDraftToken = (phone) => {
  const cleanPhone = normalizeDraftPhone(phone);
  if (cleanPhone.length !== 9 || !process.env.JWT_ACCESS_SECRET) return undefined;

  return jwt.sign({ phone: cleanPhone }, process.env.JWT_ACCESS_SECRET, {
    audience: AUDIENCE,
    expiresIn: process.env.DRAFT_TOKEN_EXPIRY || DEFAULT_EXPIRY,
  });
};

/** Returns the verified phone number, or throws if the token is invalid. */
export const verifyDraftToken = (token) => {
  const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET, { audience: AUDIENCE });
  const phone = normalizeDraftPhone(decoded.phone);
  if (phone.length !== 9) throw new Error('Draft token has no phone number');
  return phone;
};
