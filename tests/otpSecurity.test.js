process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OTP_EXPIRY_MS,
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
  assert.equal(MAX_FAILED_ATTEMPTS, 3, 'Max failed attempts must be exactly 3');
  assert.equal(LOCKOUT_DURATION_MS, 15 * 60 * 1000, 'Lockout duration must be exactly 15 minutes (900,000 ms)');
});

test('Mobile OTP Flow Security Rules', async (t) => {
  const testPhone = '0779998877';
  const cleanTestPhone = normalizePhone(testPhone);

  // Clean test state before test run
  inMemoryOtpStore.delete(cleanTestPhone);
  inMemoryLockoutStore.delete(cleanTestPhone);

  await t.test('1. Issues OTP with 5-minute expiry; resendAvailableAt equals expiresAt (no 60s cooldown)', async () => {
    const before = Date.now();
    const res = await requestOtp(testPhone);
    const after = Date.now();

    assert.equal(res.success, true);
    assert.equal(res.otp, undefined, 'Raw OTP is not exposed in response for security');
    assert.equal(res.expiresIn, 300, 'Expires in 300 seconds');
    assert.ok(res.expiresAt);
    assert.ok(res.resendAvailableAt);

    const expiresAtMs = new Date(res.expiresAt).getTime();
    const resendAtMs = new Date(res.resendAvailableAt).getTime();

    assert.ok(expiresAtMs >= before + 300000 && expiresAtMs <= after + 300000, 'Expiry is ~5 minutes from now');
    assert.equal(resendAtMs, expiresAtMs, 'resendAvailableAt is identical to expiresAt (no additional 60s cooldown)');
  });

  await t.test('2. While OTP is still valid, any resend request is rejected with OTP_STILL_VALID', async () => {
    await assert.rejects(
      async () => {
        await requestOtp(testPhone);
      },
      (err) => {
        assert.equal(err.code, 'OTP_STILL_VALID', 'Should reject with OTP_STILL_VALID while OTP is active');
        assert.equal(err.status, 429);
        assert.ok(err.otpRemaining > 0 && err.otpRemaining <= 300,
          `otpRemaining should be 1-300 seconds (got ${err.otpRemaining})`);
        return true;
      }
    );
  });

  await t.test('3. Rejects expired OTP with OTP_EXPIRED and exact error message', async () => {
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
        assert.equal(err.message, 'Your OTP has expired. Please request a new OTP.');
        return true;
      }
    );
  });

  await t.test('4. Immediately after OTP expiration, resend succeeds with NO additional 60-second waiting period', async () => {
    const cooldownPhone = '0774443322';
    const cleanCooldown = normalizePhone(cooldownPhone);
    await requestOtp(cooldownPhone);

    const record = inMemoryOtpStore.get(cleanCooldown);
    assert.ok(record);
    // Artificially expire the OTP 1 second ago
    record.expiresAt = Date.now() - 1000;
    inMemoryOtpStore.set(cleanCooldown, record);

    // Resend must succeed immediately without any 60-second cooldown wait!
    const res = await requestOtp(cooldownPhone);
    assert.equal(res.success, true);
    assert.equal(res.expiresIn, 300);
    assert.ok(res.expiresAt);
    assert.equal(new Date(res.resendAvailableAt).getTime(), new Date(res.expiresAt).getTime());

    // getOtpStatus reports active OTP with 5-minute countdown
    const status = await getOtpStatus(cooldownPhone);
    assert.equal(status.hasActiveOtp, true);
    assert.ok(status.expiresIn > 295 && status.expiresIn <= 300);
  });

  await t.test('5. Successful resend starts fresh 5-minute countdown and cycle repeats', async () => {
    const resendPhone = '0773332211';
    const cleanResend = normalizePhone(resendPhone);
    await requestOtp(resendPhone);

    const record = inMemoryOtpStore.get(cleanResend);
    assert.ok(record);
    // Age past expiry
    record.expiresAt = Date.now() - 1000;
    inMemoryOtpStore.set(cleanResend, record);

    // Resend must now succeed with fresh 5-minute validity!
    const before = Date.now();
    const res = await requestOtp(resendPhone);
    const after = Date.now();

    assert.equal(res.success, true);
    assert.equal(res.expiresIn, 300);
    const expiresAtMs = new Date(res.expiresAt).getTime();
    assert.ok(expiresAtMs >= before + 300000 && expiresAtMs <= after + 300000, 'Fresh expiry is ~5 minutes');

    // While new OTP is valid, subsequent resend is again blocked
    await assert.rejects(
      async () => {
        await requestOtp(resendPhone);
      },
      (err) => {
        assert.equal(err.code, 'OTP_STILL_VALID');
        return true;
      }
    );
  });

  await t.test('6. Tracks failed attempts up to 3 and activates 15-minute lockout', async () => {
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

  await t.test('7. Concurrent resend requests while active cannot bypass active OTP restriction', async () => {
    const concPhone = '0776665544';
    const cleanConc = normalizePhone(concPhone);
    inMemoryOtpStore.delete(cleanConc);
    inMemoryLockoutStore.delete(cleanConc);

    // First issue active OTP
    await requestOtp(concPhone);

    // Launch multiple concurrent resend attempts
    const results = await Promise.allSettled([
      requestOtp(concPhone),
      requestOtp(concPhone),
      requestOtp(concPhone),
    ]);

    // All concurrent attempts while OTP is valid must be rejected with 429
    for (const r of results) {
      assert.equal(r.status, 'rejected');
      assert.equal(r.reason.status, 429);
    }
  });
});

test('Email OTP Flow Security Rules (Identical to Mobile)', async (t) => {
  const testEmail = 'customer.portal@slt.lk';

  // Clean test state before test run
  inMemoryOtpStore.delete(testEmail);
  inMemoryLockoutStore.delete(testEmail);

  await t.test('1. Issues Email OTP with 5-minute expiry; resendAvailableAt equals expiresAt', async () => {
    const before = Date.now();
    const res = await requestOtp(testEmail);
    const after = Date.now();

    assert.equal(res.success, true);
    assert.equal(res.otp, undefined, 'Raw OTP is not exposed in response for security');
    assert.equal(res.expiresIn, 300);
    assert.ok(res.expiresAt);
    assert.ok(res.resendAvailableAt);

    const expiresAtMs = new Date(res.expiresAt).getTime();
    const resendAtMs = new Date(res.resendAvailableAt).getTime();

    assert.ok(expiresAtMs >= before + 300000 && expiresAtMs <= after + 300000, 'expiresAt is ~5 min from invocation');
    assert.equal(resendAtMs, expiresAtMs, 'resendAvailableAt is identical to expiresAt (no 60s cooldown)');
  });

  await t.test('2. While Email OTP is still valid, any resend request is rejected with OTP_STILL_VALID', async () => {
    await assert.rejects(
      async () => {
        await requestOtp(testEmail);
      },
      (err) => {
        assert.equal(err.code, 'OTP_STILL_VALID', 'Should reject with OTP_STILL_VALID while email OTP is active');
        assert.equal(err.status, 429);
        assert.ok(err.otpRemaining > 0 && err.otpRemaining <= 300,
          `otpRemaining should be 1-300 seconds (got ${err.otpRemaining})`);
        return true;
      }
    );
  });

  await t.test('3. Rejects expired Email OTP with OTP_EXPIRED and exact error message', async () => {
    const expiredEmail = 'expired.user@slt.lk';
    await requestOtp(expiredEmail);

    const record = inMemoryOtpStore.get(expiredEmail);
    assert.ok(record, 'Record should exist in inMemoryOtpStore');
    // Artificially expire the OTP
    record.expiresAt = Date.now() - 5000;
    inMemoryOtpStore.set(expiredEmail, record);

    await assert.rejects(
      async () => {
        await validateOtp(expiredEmail, record.otp);
      },
      (err) => {
        assert.equal(err.code, 'OTP_EXPIRED');
        assert.equal(err.message, 'Your OTP has expired. Please request a new OTP.');
        return true;
      }
    );
  });

  await t.test('4. Immediately after Email OTP expiration, resend succeeds with NO 60-second cooldown', async () => {
    const cooldownEmail = 'cooldown.user@slt.lk';
    await requestOtp(cooldownEmail);

    const record = inMemoryOtpStore.get(cooldownEmail);
    assert.ok(record);
    // Artificially expire the OTP 1 second ago
    record.expiresAt = Date.now() - 1000;
    inMemoryOtpStore.set(cooldownEmail, record);

    // Resend must succeed immediately without 60-second waiting period!
    const res = await requestOtp(cooldownEmail);
    assert.equal(res.success, true);
    assert.equal(res.expiresIn, 300);
    assert.ok(res.expiresAt);
    assert.equal(new Date(res.resendAvailableAt).getTime(), new Date(res.expiresAt).getTime());

    // getOtpStatus reports active OTP
    const status = await getOtpStatus(cooldownEmail);
    assert.equal(status.hasActiveOtp, true);
    assert.ok(status.expiresIn > 295 && status.expiresIn <= 300);
  });

  await t.test('5. Successful Email resend starts fresh 5-minute countdown and cycle repeats', async () => {
    const resendEmail = 'resend.ready@slt.lk';
    await requestOtp(resendEmail);

    const record = inMemoryOtpStore.get(resendEmail);
    assert.ok(record);
    // Artificially expire OTP
    record.expiresAt = Date.now() - 1000;
    inMemoryOtpStore.set(resendEmail, record);

    // Resend succeeds immediately
    const before = Date.now();
    const res = await requestOtp(resendEmail);
    const after = Date.now();

    assert.equal(res.success, true);
    assert.equal(res.expiresIn, 300);
    const expiresAtMs = new Date(res.expiresAt).getTime();
    assert.ok(expiresAtMs >= before + 300000 && expiresAtMs <= after + 300000, 'Fresh expiry is ~5 minutes');

    // While new OTP is valid, subsequent resend is rejected
    await assert.rejects(
      async () => {
        await requestOtp(resendEmail);
      },
      (err) => {
        assert.equal(err.code, 'OTP_STILL_VALID');
        return true;
      }
    );
  });

  await t.test('6. Tracks failed attempts up to 3 and activates 15-minute lockout for Email', async () => {
    const lockoutEmail = 'lockout.test@slt.lk';
    inMemoryOtpStore.delete(lockoutEmail);
    inMemoryLockoutStore.delete(lockoutEmail);

    await requestOtp(lockoutEmail);
    const validOtp = inMemoryOtpStore.get(lockoutEmail).otp;
    const invalidOtp = '888888';

    // Attempt 1: Failed
    await assert.rejects(
      async () => {
        await validateOtp(lockoutEmail, invalidOtp);
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
        await validateOtp(lockoutEmail, invalidOtp);
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
        await validateOtp(lockoutEmail, invalidOtp);
      },
      (err) => {
        assert.equal(err.code, 'OTP_LOCKED');
        assert.equal(err.status, 429);
        assert.ok(err.lockoutRemaining > 890 && err.lockoutRemaining <= 900);
        return true;
      }
    );

    // Attempt 4: Rejected due to active lockout
    await assert.rejects(
      async () => {
        await validateOtp(lockoutEmail, validOtp);
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
        await requestOtp(lockoutEmail);
      },
      (err) => {
        assert.equal(err.code, 'OTP_LOCKED');
        assert.equal(err.status, 429);
        return true;
      }
    );

    // getOtpStatus reports lockout details
    const status = await getOtpStatus(lockoutEmail);
    assert.equal(status.isLocked, true);
    assert.ok(status.lockoutRemaining > 0);
  });

  await t.test('7. Concurrent Email resend requests while active cannot bypass active OTP restriction', async () => {
    const concEmail = 'concurrent@slt.lk';
    inMemoryOtpStore.delete(concEmail);
    inMemoryLockoutStore.delete(concEmail);

    // First issue active OTP
    await requestOtp(concEmail);

    // Launch multiple concurrent resend attempts
    const results = await Promise.allSettled([
      requestOtp(concEmail),
      requestOtp(concEmail),
      requestOtp(concEmail),
    ]);

    for (const r of results) {
      assert.equal(r.status, 'rejected');
      assert.equal(r.reason.status, 429);
    }
  });
});
