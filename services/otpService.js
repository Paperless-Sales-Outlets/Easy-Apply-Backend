import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import Otp from '../models/Otp.js';
import OtpLockout from '../models/OtpLockout.js';

export const OTP_EXPIRY_MS = 5 * 60 * 1000; // Exactly 5 minutes validity (300 seconds)
export const RESEND_COOLDOWN_MS = 60 * 1000; // Exactly 1-minute resend cooldown (60 seconds)
export const MAX_FAILED_ATTEMPTS = 3; // Maximum 3 incorrect OTP verification attempts
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // Exactly 15-minute lockout (900 seconds)

export const inMemoryOtpStore = new Map();
export const inMemoryLockoutStore = new Map();

/**
 * Normalizes phone numbers to standard 9-digit Sri Lankan national format (e.g. 771234567)
 */
export const normalizePhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.slice(-9);
};

/**
 * Builds standard Mongo query to match common phone representations
 */
export const buildPhoneQuery = (cleanPhone, rawPhone = '') => {
  const queries = [
    { phone: cleanPhone },
    { phone: `0${cleanPhone}` },
    { phone: `94${cleanPhone}` },
    { phone: `+94${cleanPhone}` },
  ];
  if (rawPhone && String(rawPhone).trim()) {
    queries.push({ phone: String(rawPhone).trim() });
  }
  return { $or: queries };
};

/**
 * Helper to fetch lockout record
 */
const getLockoutRecord = async (cleanPhone) => {
  if (mongoose.connection.readyState === 1) {
    return await OtpLockout.findOne({ phone: cleanPhone });
  }
  return inMemoryLockoutStore.get(cleanPhone) || null;
};

/**
 * Helper to save lockout record
 */
const saveLockoutRecord = async (cleanPhone, failedAttempts, lockedUntil) => {
  if (mongoose.connection.readyState === 1) {
    return await OtpLockout.findOneAndUpdate(
      { phone: cleanPhone },
      { failedAttempts, lockedUntil, updatedAt: new Date() },
      { upsert: true, new: true }
    );
  }
  const rec = { phone: cleanPhone, failedAttempts, lockedUntil, updatedAt: Date.now() };
  inMemoryLockoutStore.set(cleanPhone, rec);
  return rec;
};

/**
 * Helper to clear lockout record
 */
const clearLockoutRecord = async (cleanPhone) => {
  if (mongoose.connection.readyState === 1) {
    await OtpLockout.deleteOne({ phone: cleanPhone });
  } else {
    inMemoryLockoutStore.delete(cleanPhone);
  }
};

/**
 * Checks if the phone number is currently in the 15-minute lockout state.
 * Throws 429 if locked out.
 */
export const checkLockout = async (cleanPhone) => {
  const now = Date.now();
  const lockout = await getLockoutRecord(cleanPhone);
  if (lockout && lockout.lockedUntil) {
    const lockedUntilMs = new Date(lockout.lockedUntil).getTime();
    if (now < lockedUntilMs) {
      const remainingSeconds = Math.ceil((lockedUntilMs - now) / 1000);
      const error = new Error('Too many incorrect OTP attempts. OTP verification is locked for 15 minutes.');
      error.status = 429;
      error.code = 'OTP_LOCKED';
      error.lockoutRemaining = remainingSeconds;
      error.lockedUntil = new Date(lockedUntilMs).toISOString();
      throw error;
    } else {
      // 15-minute lockout has elapsed! Clear lockout so user can proceed
      await clearLockoutRecord(cleanPhone);
    }
  }
};

/**
 * Returns current OTP and lockout status for a phone number
 */
export const getOtpStatus = async (phone) => {
  if (!phone) {
    const error = new Error('Phone number is required');
    error.status = 400;
    throw error;
  }

  const cleanPhone = normalizePhone(phone);
  const now = Date.now();

  const lockout = await getLockoutRecord(cleanPhone);
  let isLocked = false;
  let lockoutRemaining = 0;
  let lockedUntil = null;

  if (lockout && lockout.lockedUntil) {
    const lockedUntilMs = new Date(lockout.lockedUntil).getTime();
    if (now < lockedUntilMs) {
      isLocked = true;
      lockoutRemaining = Math.ceil((lockedUntilMs - now) / 1000);
      lockedUntil = new Date(lockedUntilMs).toISOString();
    } else {
      await clearLockoutRecord(cleanPhone);
    }
  }

  if (isLocked) {
    return {
      success: true,
      phone: cleanPhone,
      isLocked: true,
      lockedUntil,
      lockoutRemaining,
      hasActiveOtp: false,
      expiresIn: 0,
      resendCooldown: 0,
      attemptsRemaining: 0,
    };
  }

  let activeOtp = null;
  if (mongoose.connection.readyState === 1) {
    activeOtp = await Otp.findOne(buildPhoneQuery(cleanPhone, phone)).sort({ createdAt: -1 });
  } else {
    activeOtp = inMemoryOtpStore.get(cleanPhone) || null;
  }

  let hasActiveOtp = false;
  let expiresIn = 0;
  let expiresAt = null;
  let resendCooldown = 0;
  let resendAvailableAt = null;

  if (activeOtp) {
    const expiresAtMs = activeOtp.expiresAt
      ? new Date(activeOtp.expiresAt).getTime()
      : new Date(activeOtp.createdAt).getTime() + OTP_EXPIRY_MS;

    if (now < expiresAtMs) {
      hasActiveOtp = true;
      expiresIn = Math.ceil((expiresAtMs - now) / 1000);
      expiresAt = new Date(expiresAtMs).toISOString();

      const lastSentMs = new Date(activeOtp.lastSentAt || activeOtp.createdAt).getTime();
      const elapsed = now - lastSentMs;
      if (elapsed < RESEND_COOLDOWN_MS) {
        resendCooldown = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        resendAvailableAt = new Date(lastSentMs + RESEND_COOLDOWN_MS).toISOString();
      }
    }
  }

  const attemptsRemaining = Math.max(0, MAX_FAILED_ATTEMPTS - (lockout?.failedAttempts || 0));

  return {
    success: true,
    phone: cleanPhone,
    isLocked: false,
    lockedUntil: null,
    lockoutRemaining: 0,
    hasActiveOtp,
    expiresAt,
    expiresIn,
    resendCooldown,
    resendAvailableAt,
    attemptsRemaining,
  };
};

/**
 * Generates and issues a new OTP for a phone number.
 * Enforces:
 * - 15-minute lockout check: blocked if user is currently locked out
 * - 60-second resend cooldown: HTTP 429 if requested within cooldown
 * - 5-minute expiry timestamp
 * - Invalidation of any previously issued OTPs for this phone
 * - Reset of attempt counter for the new OTP challenge (when not locked out)
 * - Safe response: never exposes OTP value
 */
export const requestOtp = async (phone) => {
  if (!phone) {
    const error = new Error('Phone number is required');
    error.status = 400;
    throw error;
  }

  const cleanPhone = normalizePhone(phone);
  if (cleanPhone.length !== 9) {
    const error = new Error('Please enter a valid 9-digit Sri Lankan mobile number');
    error.status = 400;
    throw error;
  }

  const now = Date.now();

  // 1. Enforce 15-Minute Lockout: Repeated resend cannot bypass verification lockout
  await checkLockout(cleanPhone);

  // 2. Block resend while current OTP is still valid, then enforce 60-second cooldown after expiry.
  //    Resend is only permitted after: OTP has expired AND 60 seconds have passed since expiry.
  if (mongoose.connection.readyState === 1) {
    const existing = await Otp.findOne(buildPhoneQuery(cleanPhone, phone)).sort({ createdAt: -1 });
    if (existing) {
      const expiresAtMs = existing.expiresAt
        ? new Date(existing.expiresAt).getTime()
        : new Date(existing.createdAt).getTime() + OTP_EXPIRY_MS;

      if (now < expiresAtMs) {
        // OTP is still valid — completely block resend
        const remainingSeconds = Math.ceil((expiresAtMs - now) / 1000);
        const resendAllowedAt = new Date(expiresAtMs + RESEND_COOLDOWN_MS);
        const error = new Error('A valid OTP has already been sent. Please wait for it to expire before requesting a new one.');
        error.status = 429;
        error.code = 'OTP_STILL_VALID';
        error.otpRemaining = remainingSeconds;
        error.expiresAt = new Date(expiresAtMs).toISOString();
        error.resendAvailableAt = resendAllowedAt.toISOString();
        throw error;
      }

      // OTP has expired — enforce 60-second cooldown measured from expiry time
      const cooldownStartMs = expiresAtMs;
      const elapsedSinceExpiry = now - cooldownStartMs;
      if (elapsedSinceExpiry < RESEND_COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsedSinceExpiry) / 1000);
        const error = new Error(`Please wait ${remainingSeconds} seconds before requesting a new OTP.`);
        error.status = 429;
        error.code = 'RESEND_COOLDOWN';
        error.cooldownRemaining = remainingSeconds;
        error.resendAvailableAt = new Date(cooldownStartMs + RESEND_COOLDOWN_MS).toISOString();
        throw error;
      }
    }
  } else {
    const existing = inMemoryOtpStore.get(cleanPhone);
    if (existing) {
      const expiresAtMs = typeof existing.expiresAt === 'number'
        ? existing.expiresAt
        : Number(existing.createdAt) + OTP_EXPIRY_MS;

      if (now < expiresAtMs) {
        // OTP is still valid — completely block resend
        const remainingSeconds = Math.ceil((expiresAtMs - now) / 1000);
        const resendAllowedAt = new Date(expiresAtMs + RESEND_COOLDOWN_MS);
        const error = new Error('A valid OTP has already been sent. Please wait for it to expire before requesting a new one.');
        error.status = 429;
        error.code = 'OTP_STILL_VALID';
        error.otpRemaining = remainingSeconds;
        error.expiresAt = new Date(expiresAtMs).toISOString();
        error.resendAvailableAt = resendAllowedAt.toISOString();
        throw error;
      }

      // OTP has expired — enforce 60-second cooldown measured from expiry time
      const cooldownStartMs = expiresAtMs;
      const elapsedSinceExpiry = now - cooldownStartMs;
      if (elapsedSinceExpiry < RESEND_COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsedSinceExpiry) / 1000);
        const error = new Error(`Please wait ${remainingSeconds} seconds before requesting a new OTP.`);
        error.status = 429;
        error.code = 'RESEND_COOLDOWN';
        error.cooldownRemaining = remainingSeconds;
        error.resendAvailableAt = new Date(cooldownStartMs + RESEND_COOLDOWN_MS).toISOString();
        throw error;
      }
    }
  }

  // 3. Invalidate previous OTPs for this phone
  if (mongoose.connection.readyState === 1) {
    await Otp.deleteMany(buildPhoneQuery(cleanPhone, phone));
  } else {
    inMemoryOtpStore.delete(cleanPhone);
  }

  // 4. Reset attempt counter for new OTP challenge (since not locked out)
  await clearLockoutRecord(cleanPhone);

  // 5. Generate 6-digit numeric OTP and timestamps.
  //    resendAvailableAt = OTP expiry time + 60-second cooldown (not 60s from now).
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(now + OTP_EXPIRY_MS);
  const resendAvailableAt = new Date(now + OTP_EXPIRY_MS + RESEND_COOLDOWN_MS);

  // 6. Store in Database or In-Memory fallback
  if (mongoose.connection.readyState === 1) {
    await Otp.create({
      phone: cleanPhone,
      otp: otpCode,
      createdAt: new Date(now),
      lastSentAt: new Date(now),
      expiresAt,
      failedAttempts: 0,
    });
  } else {
    inMemoryOtpStore.set(cleanPhone, {
      otp: otpCode,
      createdAt: now,
      lastSentAt: now,
      expiresAt: expiresAt.getTime(),
      failedAttempts: 0,
    });
  }

  console.log(`[OTP] Generated verification code for +94 ${cleanPhone} (Valid: 5m, then 60s resend cooldown)`);

  return {
    success: true,
    message: 'OTP sent successfully to your mobile number.',
    expiresIn: Math.ceil(OTP_EXPIRY_MS / 1000),
    expiresAt: expiresAt.toISOString(),
    resendCooldown: Math.ceil(RESEND_COOLDOWN_MS / 1000),
    resendAvailableAt: resendAvailableAt.toISOString(),
  };
};

/**
 * Verifies an OTP code submitted by the user.
 * Enforces:
 * - 15-minute lockout check: rejects ALL attempts during lockout
 * - 5-minute validity check: rejects expired OTPs
 * - Max 3 incorrect attempts: 3rd failed attempt triggers 15-minute lockout
 * - Invalidation upon success: deleted immediately so cannot be reused
 * - Clearing of attempt/lockout counters upon successful verification
 */
export const validateOtp = async (phone, inputOtp) => {
  if (!phone || !inputOtp) {
    const error = new Error('Phone number and OTP code are required');
    error.status = 400;
    throw error;
  }

  const cleanPhone = normalizePhone(phone);
  const cleanOtp = String(inputOtp).trim();
  const now = Date.now();

  // 1. Check 15-Minute Lockout first
  await checkLockout(cleanPhone);

  // 2. Fetch active OTP record
  let record = null;
  if (mongoose.connection.readyState === 1) {
    record = await Otp.findOne(buildPhoneQuery(cleanPhone, phone));
  } else {
    record = inMemoryOtpStore.get(cleanPhone);
  }

  if (!record) {
    const error = new Error('Your OTP has expired or was not requested. Please request a new OTP.');
    error.status = 400;
    error.code = 'OTP_EXPIRED';
    throw error;
  }

  // 3. Check 5-Minute Expiry
  const expiresAtMs = record.expiresAt
    ? new Date(record.expiresAt).getTime()
    : new Date(record.createdAt).getTime() + OTP_EXPIRY_MS;

  if (now > expiresAtMs) {
    if (mongoose.connection.readyState === 1) {
      await Otp.deleteMany(buildPhoneQuery(cleanPhone, phone));
    } else {
      inMemoryOtpStore.delete(cleanPhone);
    }
    const error = new Error('Your OTP has expired. Please request a new OTP.');
    error.status = 400;
    error.code = 'OTP_EXPIRED';
    throw error;
  }

  // 4. Verify OTP Code
  let isMatch = false;
  if (record.otp === cleanOtp) {
    isMatch = true;
  } else if (typeof record.otp === 'string' && record.otp.startsWith('$2')) {
    isMatch = await bcrypt.compare(cleanOtp, record.otp);
  }

  // In non-production development, accept demo code 000000 or 123456 ONLY if valid, non-expired, non-locked
  if (!isMatch && process.env.NODE_ENV !== 'production' && (cleanOtp === '000000' || cleanOtp === '123456')) {
    isMatch = true;
  }

  // 5. Handle Incorrect Attempt
  if (!isMatch) {
    const currentLockout = (await getLockoutRecord(cleanPhone)) || { failedAttempts: 0 };
    const newFailed = (currentLockout.failedAttempts || 0) + 1;

    if (newFailed >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(now + LOCKOUT_DURATION_MS);
      await saveLockoutRecord(cleanPhone, newFailed, lockedUntil);

      // Invalidate current OTP
      if (mongoose.connection.readyState === 1) {
        await Otp.deleteMany(buildPhoneQuery(cleanPhone, phone));
      } else {
        inMemoryOtpStore.delete(cleanPhone);
      }

      const error = new Error('Too many incorrect OTP attempts. OTP verification is locked for 15 minutes.');
      error.status = 429;
      error.code = 'OTP_LOCKED';
      error.lockoutRemaining = 900;
      error.lockedUntil = lockedUntil.toISOString();
      throw error;
    } else {
      await saveLockoutRecord(cleanPhone, newFailed, null);

      const remainingTries = MAX_FAILED_ATTEMPTS - newFailed;
      const errorMsg = `Invalid verification code. Please try again. (${remainingTries} attempt${remainingTries === 1 ? '' : 's'} remaining)`;
      const error = new Error(errorMsg);
      error.status = 400;
      error.code = 'OTP_INVALID';
      error.attemptsRemaining = remainingTries;
      throw error;
    }
  }

  // 6. Match Succeeded: Delete OTP immediately and clear lockout record
  if (mongoose.connection.readyState === 1) {
    await Otp.deleteMany(buildPhoneQuery(cleanPhone, phone));
  } else {
    inMemoryOtpStore.delete(cleanPhone);
  }
  await clearLockoutRecord(cleanPhone);

  return {
    success: true,
    message: 'Phone number verified successfully',
  };
};

export default {
  requestOtp,
  validateOtp,
  getOtpStatus,
  checkLockout,
  normalizePhone,
  buildPhoneQuery,
  OTP_EXPIRY_MS,
  RESEND_COOLDOWN_MS,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
};
