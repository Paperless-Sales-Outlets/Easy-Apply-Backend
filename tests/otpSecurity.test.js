import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OTP_EXPIRY_MS,
  RESEND_COOLDOWN_MS,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  normalizePhone,
  requestOtp,
  validateOtp,
  getOtpStatus,
  inMemoryOtpStore,
  inMemoryLockoutStore,
} from '../services/otpService.js';

test('OTP Security Constants', () => {
  assert.equal(OTP_EXPIRY_MS, 5 * 60 * 1000, 'OTP expiry must be exactly 5 minutes (300,000 ms)');
  assert.equal(RESEND_COOLDOWN_MS, 60 * 1000, 'Resend cooldown must be exactly 60 seconds (60,000 ms)');
  assert.equal(MAX_FAILED_ATTEMPTS, 3, 'Max failed attempts must be exactly 3');
  assert.equal(LOCKOUT_DURATION_MS, 15 * 60 * 1000, 'Lockout duration must be exactly 15 minutes (900,000 ms)');
});

test('OTP Flow Security Rules', async (t) => {
  const testPhone = '0779998877';
  const cleanTestPhone = normalizePhone(testPhone);

  // Clean test state before test run
  inMemoryOtpStore.delete(cleanTestPhone);
  inMemoryLockoutStore.delete(cleanTestPhone);

  await t.test('1. Issues OTP with 5-minute expiry and 60-second resend cooldown (does not expose raw OTP)', async () => {
    const res = await requestOtp(testPhone);
    assert.equal(res.success, true);
    assert.equal(res.otp, undefined, 'Raw OTP is not exposed in response for security');
    assert.ok(res.expiresAt);
    assert.ok(res.resendAvailableAt);

    const now = Date.now();
    const expiryDiff = new Date(res.expiresAt).getTime() - now;
    const cooldownDiff = new Date(res.resendAvailableAt).getTime() - now;

    assert.ok(expiryDiff > 298000 && expiryDiff <= 300000, 'Expiry is ~5 minutes');
    assert.ok(cooldownDiff > 58000 && cooldownDiff <= 60000, 'Cooldown is ~60 seconds');
  });

  await t.test('2. Enforces 60-second cooldown on rapid resend', async () => {
    await assert.rejects(
      async () => {
        await requestOtp(testPhone);
      },
      (err) => {
        assert.equal(err.code, 'RESEND_COOLDOWN');
        assert.equal(err.status, 429);
        assert.ok(err.cooldownRemaining > 0 && err.cooldownRemaining <= 60);
        return true;
      }
    );
  });

  await t.test('3. Rejects expired OTP', async () => {
    const expiredPhone = '0775554433';
    const cleanExpired = normalizePhone(expiredPhone);
    await requestOtp(expiredPhone);

    const record = inMemoryOtpStore.get(cleanExpired);
    assert.ok(record, 'Record should exist in inMemoryOtpStore');
    // Artificially expire the OTP
    record.expiresAt = Date.now() - 5000;
    inMemoryOtpStore.set(cleanExpired, record);

    await assert.rejects(
      async () => {
        await validateOtp(expiredPhone, record.otp);
      },
      (err) => {
        assert.equal(err.code, 'OTP_EXPIRED');
        return true;
      }
    );
  });

  await t.test('4. Tracks failed attempts up to 3 and activates 15-minute lockout', async () => {
    const lockoutPhone = '0771112233';
    const cleanLockout = normalizePhone(lockoutPhone);
    inMemoryOtpStore.delete(cleanLockout);
    inMemoryLockoutStore.delete(cleanLockout);

    await requestOtp(lockoutPhone);
    const validOtp = inMemoryOtpStore.get(cleanLockout).otp;
    const invalidOtp = '888888'; // not a demo code

    // Attempt 1: Failed
    await assert.rejects(
      async () => {
        await validateOtp(lockoutPhone, invalidOtp);
      },
      (err) => {
        assert.equal(err.code, 'OTP_INVALID');
        assert.equal(err.attemptsRemaining, 2);
        return true;
      }
    );

    // Attempt 2: Failed
    await assert.rejects(
      async () => {
        await validateOtp(lockoutPhone, invalidOtp);
      },
      (err) => {
        assert.equal(err.code, 'OTP_INVALID');
        assert.equal(err.attemptsRemaining, 1);
        return true;
      }
    );

    // Attempt 3: Failed -> triggers 15-minute lockout
    await assert.rejects(
      async () => {
        await validateOtp(lockoutPhone, invalidOtp);
      },
      (err) => {
        assert.equal(err.code, 'OTP_LOCKED');
        assert.equal(err.status, 429);
        assert.ok(err.lockoutRemaining > 890 && err.lockoutRemaining <= 900);
        return true;
      }
    );

    // Attempt 4 (even with correct OTP!): Rejected due to active lockout
    await assert.rejects(
      async () => {
        await validateOtp(lockoutPhone, validOtp);
      },
      (err) => {
        assert.equal(err.code, 'OTP_LOCKED');
        assert.equal(err.status, 429);
        return true;
      }
    );

    // Resend attempt during lockout is also blocked
    await assert.rejects(
      async () => {
        await requestOtp(lockoutPhone);
      },
      (err) => {
        assert.equal(err.code, 'OTP_LOCKED');
        assert.equal(err.status, 429);
        return true;
      }
    );

    // getOtpStatus reports lockout details
    const status = await getOtpStatus(lockoutPhone);
    assert.equal(status.isLocked, true);
    assert.ok(status.lockoutRemaining > 0);
  });
});
