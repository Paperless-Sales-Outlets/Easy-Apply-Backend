import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import Otp from '../models/Otp.js';
import OtpLockout from '../models/OtpLockout.js';
import { sendOtpEmail } from './emailService.js';

export const OTP_EXPIRY_MS = 5 * 60 * 1000; // Exactly 5 minutes validity (300 seconds)
export const MAX_FAILED_ATTEMPTS = 3; // Maximum 3 incorrect OTP verification attempts
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // Exactly 15-minute lockout (900 seconds)

export const inMemoryOtpStore = new Map();
export const inMemoryLockoutStore = new Map();
const pendingRequests = new Set(); // Concurrency protection against simultaneous resend requests

/**
 * Normalizes phone numbers to standard 9-digit Sri Lankan national format (e.g. 771234567)
 */
export const normalizePhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.slice(-9);
};

/**
 * Normalizes email address to lower case and trimmed string
 */
export const normalizeEmail = (email) => {
  return String(email || '').trim().toLowerCase();
};

/**
 * Determines whether a target string represents an email address
 */
export const isEmail = (target) => {
  return typeof target === 'string' && target.includes('@');
};

/**
 * Normalizes any target (phone or email)
 */
export const normalizeTarget = (target) => {
  if (!target) return '';
  const str = String(target).trim();
  if (isEmail(str)) return normalizeEmail(str);
  return normalizePhone(str);
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
    { target: cleanPhone },
  ];
  if (rawPhone && String(rawPhone).trim()) {
    queries.push({ phone: String(rawPhone).trim() });
  }
  return { $or: queries };
};

/**
 * Builds standard Mongo query for either phone or email
 */
export const buildTargetQuery = (cleanTarget, rawTarget = '') => {
  if (isEmail(cleanTarget)) {
    return {
      $or: [
        { email: cleanTarget },
        { target: cleanTarget },
      ],
    };
  }
  return buildPhoneQuery(cleanTarget, rawTarget);
};

/**
 * Helper to fetch lockout record
 */
const getLockoutRecord = async (cleanTarget) => {
  if (mongoose.connection.readyState === 1) {
    if (isEmail(cleanTarget)) {
      return await OtpLockout.findOne({ $or: [{ email: cleanTarget }, { target: cleanTarget }] });
    }
    return await OtpLockout.findOne({ $or: [{ phone: cleanTarget }, { target: cleanTarget }] });
  }
  return inMemoryLockoutStore.get(cleanTarget) || null;
};

/**
 * Helper to save lockout record
 */
const saveLockoutRecord = async (cleanTarget, failedAttempts, lockedUntil) => {
  if (mongoose.connection.readyState === 1) {
    const isMail = isEmail(cleanTarget);
    const filter = isMail
      ? { $or: [{ email: cleanTarget }, { target: cleanTarget }] }
      : { $or: [{ phone: cleanTarget }, { target: cleanTarget }] };

    const doc = isMail
      ? { email: cleanTarget, target: cleanTarget, failedAttempts, lockedUntil, updatedAt: new Date() }
      : { phone: cleanTarget, target: cleanTarget, failedAttempts, lockedUntil, updatedAt: new Date() };

    return await OtpLockout.findOneAndUpdate(
      filter,
      doc,
      { upsert: true, new: true }
    );
  }
  const rec = { target: cleanTarget, failedAttempts, lockedUntil, updatedAt: Date.now() };
  inMemoryLockoutStore.set(cleanTarget, rec);
  return rec;
};

/**
 * Helper to clear lockout record
 */
const clearLockoutRecord = async (cleanTarget) => {
  if (mongoose.connection.readyState === 1) {
    const isMail = isEmail(cleanTarget);
    const filter = isMail
      ? { $or: [{ email: cleanTarget }, { target: cleanTarget }] }
      : { $or: [{ phone: cleanTarget }, { target: cleanTarget }] };
    await OtpLockout.deleteMany(filter);
  } else {
    inMemoryLockoutStore.delete(cleanTarget);
  }
};

/**
 * Checks if the target (phone or email) is currently in the 15-minute lockout state.
 * Throws 429 if locked out.
 */
export const checkLockout = async (cleanTarget) => {
  const now = Date.now();
  const lockout = await getLockoutRecord(cleanTarget);
  if (lockout && lockout.lockedUntil) {
    const lockedUntilMs = new Date(lockout.lockedUntil).getTime();
    if (now < lockedUntilMs) {
      const remainingSeconds = Math.ceil((lockedUntilMs - now) / 1000);
      const isMail = isEmail(cleanTarget);
      const error = new Error(`Too many incorrect OTP attempts. ${isMail ? 'Email' : 'OTP'} verification is locked for 15 minutes.`);
      error.status = 429;
      error.code = 'OTP_LOCKED';
      error.lockoutRemaining = remainingSeconds;
      error.lockedUntil = new Date(lockedUntilMs).toISOString();
      throw error;
    } else {
      // 15-minute lockout has elapsed! Clear lockout so user can proceed
      await clearLockoutRecord(cleanTarget);
    }
  }
};

/**
 * Returns current OTP and lockout status for a phone number or email address
 */
export const getOtpStatus = async (target) => {
  if (!target) {
    const error = new Error('Phone number or email address is required');
    error.status = 400;
    throw error;
  }

  const cleanTarget = normalizeTarget(target);
  const isMail = isEmail(target);
  const now = Date.now();

  const lockout = await getLockoutRecord(cleanTarget);
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
      await clearLockoutRecord(cleanTarget);
    }
  }

  if (isLocked) {
    return {
      success: true,
      target: cleanTarget,
      phone: isMail ? undefined : cleanTarget,
      email: isMail ? cleanTarget : undefined,
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
    activeOtp = await Otp.findOne(buildTargetQuery(cleanTarget, target)).sort({ createdAt: -1 });
  } else {
    activeOtp = inMemoryOtpStore.get(cleanTarget) || null;
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
      resendAvailableAt = new Date(expiresAtMs).toISOString();
    } else {
      // OTP has expired - resend is immediately available
      hasActiveOtp = false;
      expiresIn = 0;
      expiresAt = new Date(expiresAtMs).toISOString();
      resendAvailableAt = new Date(expiresAtMs).toISOString();
    }
  }

  const attemptsRemaining = Math.max(0, MAX_FAILED_ATTEMPTS - (lockout?.failedAttempts || 0));

  return {
    success: true,
    target: cleanTarget,
    phone: isMail ? undefined : cleanTarget,
    email: isMail ? cleanTarget : undefined,
    isLocked: false,
    lockedUntil: null,
    lockoutRemaining: 0,
    hasActiveOtp,
    expiresAt,
    expiresIn,
    resendCooldown: 0,
    resendAvailableAt,
    attemptsRemaining,
  };
};

/**
 * Generates and issues a new OTP for a phone number or email address.
 * Enforces:
 * - 15-minute lockout check: blocked if target is currently locked out
 * - 5-minute OTP validity period
 * - Resend restriction: strictly blocked while OTP is active (first 5 minutes)
 * - Immediate resend available as soon as the 5-minute OTP expires (no 60s cooldown)
 * - Concurrency protection: duplicate/concurrent resends while processing are rejected
 * - Invalidation of any previously issued OTPs for this target
 * - Reset of attempt counter for the new OTP challenge (when not locked out)
 * - Safe response: never exposes raw OTP value
 */
export const requestOtp = async (target) => {
  if (!target) {
    const error = new Error('Phone number or email address is required');
    error.status = 400;
    throw error;
  }

  const isMail = isEmail(target);
  const cleanTarget = normalizeTarget(target);

  if (isMail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanTarget)) {
      const error = new Error('Please enter a valid email address');
      error.status = 400;
      throw error;
    }
  } else {
    if (cleanTarget.length !== 9) {
      const error = new Error('Please enter a valid 9-digit Sri Lankan mobile number');
      error.status = 400;
      throw error;
    }
  }

  // Prevent duplicate or concurrent resend requests while a request is in flight
  if (pendingRequests.has(cleanTarget)) {
    const error = new Error('A verification code request is already being processed. Please wait.');
    error.status = 429;
    error.code = 'REQUEST_IN_PROGRESS';
    throw error;
  }
  pendingRequests.add(cleanTarget);

  try {
    const now = Date.now();

    // 1. Enforce 15-Minute Lockout: Repeated resend cannot bypass verification lockout
    await checkLockout(cleanTarget);

    // 2. Block resend while current OTP is still valid (5-minute validity period).
    //    Resend is permitted immediately once the OTP expires (no 60s cooldown).
    let existing = null;
    if (mongoose.connection.readyState === 1) {
      existing = await Otp.findOne(buildTargetQuery(cleanTarget, target)).sort({ createdAt: -1 });
    } else {
      existing = inMemoryOtpStore.get(cleanTarget);
    }

    if (existing) {
      const expiresAtMs = existing.expiresAt
        ? new Date(existing.expiresAt).getTime()
        : (typeof existing.createdAt === 'number' ? existing.createdAt : new Date(existing.createdAt).getTime()) + OTP_EXPIRY_MS;

      if (now < expiresAtMs) {
        // OTP is still valid — completely block resend during 5-minute validity
        const remainingSeconds = Math.ceil((expiresAtMs - now) / 1000);
        const error = new Error('A valid OTP has already been sent. Please wait for it to expire before requesting a new one.');
        error.status = 429;
        error.code = 'OTP_STILL_VALID';
        error.otpRemaining = remainingSeconds;
        error.expiresAt = new Date(expiresAtMs).toISOString();
        error.resendAvailableAt = new Date(expiresAtMs).toISOString();
        throw error;
      }

      // OTP has expired — no additional 60-second cooldown! Resend allowed immediately.
    }

    // 3. Invalidate previous OTPs for this target
    if (mongoose.connection.readyState === 1) {
      await Otp.deleteMany(buildTargetQuery(cleanTarget, target));
    } else {
      inMemoryOtpStore.delete(cleanTarget);
    }

    // 4. Reset attempt counter for new OTP challenge (since not locked out)
    await clearLockoutRecord(cleanTarget);

    // 5. Generate 6-digit numeric OTP and timestamps.
    //    resendAvailableAt = OTP expiry time (available immediately at 5 minutes).
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(now + OTP_EXPIRY_MS);
    const resendAvailableAt = new Date(now + OTP_EXPIRY_MS);

    // 6. Store in Database or In-Memory fallback
    if (mongoose.connection.readyState === 1) {
      const doc = isMail
        ? { email: cleanTarget, target: cleanTarget, otp: otpCode, createdAt: new Date(now), lastSentAt: new Date(now), expiresAt, failedAttempts: 0 }
        : { phone: cleanTarget, target: cleanTarget, otp: otpCode, createdAt: new Date(now), lastSentAt: new Date(now), expiresAt, failedAttempts: 0 };
      await Otp.create(doc);
    } else {
      inMemoryOtpStore.set(cleanTarget, {
        otp: otpCode,
        createdAt: now,
        lastSentAt: now,
        expiresAt: expiresAt.getTime(),
        failedAttempts: 0,
        target: cleanTarget,
        isMail,
      });
    }

    if (isMail) {
      console.log(`[OTP] Generated verification code for ${cleanTarget} (Valid: 5m, immediate resend upon expiry)`);
      try {
        await sendOtpEmail({ to: cleanTarget, otpCode });
      } catch (mailErr) {
        console.warn(`[OTP] Notice: Email delivery failed for ${cleanTarget}:`, mailErr.message);
      }
    } else {
      console.log(`[OTP] Generated verification code for +94 ${cleanTarget} (Valid: 5m, immediate resend upon expiry)`);
    }

    return {
      success: true,
      message: isMail ? 'Verification code sent to your email address.' : 'OTP sent successfully to your mobile number.',
      expiresIn: Math.ceil(OTP_EXPIRY_MS / 1000),
      expiresAt: expiresAt.toISOString(),
      resendAvailableAt: resendAvailableAt.toISOString(),
    };
  } finally {
    pendingRequests.delete(cleanTarget);
  }
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
export const validateOtp = async (target, inputOtp) => {
  if (!target || !inputOtp) {
    const error = new Error('Phone number or email and OTP code are required');
    error.status = 400;
    throw error;
  }

  const isMail = isEmail(target);
  const cleanTarget = normalizeTarget(target);
  const cleanOtp = String(inputOtp).trim();
  const now = Date.now();

  // 1. Check 15-Minute Lockout first
  await checkLockout(cleanTarget);

  // 2. Fetch active OTP record
  let record = null;
  if (mongoose.connection.readyState === 1) {
    record = await Otp.findOne(buildTargetQuery(cleanTarget, target));
  } else {
    record = inMemoryOtpStore.get(cleanTarget);
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
      await Otp.deleteMany(buildTargetQuery(cleanTarget, target));
    } else {
      inMemoryOtpStore.delete(cleanTarget);
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
    const currentLockout = (await getLockoutRecord(cleanTarget)) || { failedAttempts: 0 };
    const newFailed = (currentLockout.failedAttempts || 0) + 1;

    if (newFailed >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(now + LOCKOUT_DURATION_MS);
      await saveLockoutRecord(cleanTarget, newFailed, lockedUntil);

      // Invalidate current OTP
      if (mongoose.connection.readyState === 1) {
        await Otp.deleteMany(buildTargetQuery(cleanTarget, target));
      } else {
        inMemoryOtpStore.delete(cleanTarget);
      }

      const error = new Error(`Too many incorrect OTP attempts. ${isMail ? 'Email' : 'OTP'} verification is locked for 15 minutes.`);
      error.status = 429;
      error.code = 'OTP_LOCKED';
      error.lockoutRemaining = 900;
      error.lockedUntil = lockedUntil.toISOString();
      throw error;
    } else {
      await saveLockoutRecord(cleanTarget, newFailed, null);

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
    await Otp.deleteMany(buildTargetQuery(cleanTarget, target));
  } else {
    inMemoryOtpStore.delete(cleanTarget);
  }
  await clearLockoutRecord(cleanTarget);

  return {
    success: true,
    message: isMail ? 'Email address verified successfully' : 'Phone number verified successfully',
  };
};

export const requestEmailOtp = (email) => requestOtp(email);
export const validateEmailOtp = (email, otp) => validateOtp(email, otp);
export const getEmailOtpStatus = (email) => getOtpStatus(email);

export default {
  requestOtp,
  validateOtp,
  getOtpStatus,
  checkLockout,
  normalizePhone,
  normalizeEmail,
  normalizeTarget,
  isEmail,
  buildPhoneQuery,
  buildTargetQuery,
  requestEmailOtp,
  validateEmailOtp,
  getEmailOtpStatus,
  OTP_EXPIRY_MS,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
};
