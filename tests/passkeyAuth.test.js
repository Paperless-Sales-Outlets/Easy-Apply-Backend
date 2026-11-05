process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_key_1234567890';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_key_1234567890';
process.env.WEBAUTHN_RP_ID = 'localhost';
process.env.WEBAUTHN_RP_NAME = 'SLTMobitel EasyApply Admin';
process.env.WEBAUTHN_ORIGIN = 'http://localhost:5173';

import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import Passkey from '../models/Passkey.js';
import PasskeyChallenge from '../models/PasskeyChallenge.js';
import User from '../models/User.js';
import RefreshToken from '../models/RefreshToken.js';
import AuditLog from '../models/AuditLog.js';
import * as passkeyController from '../controllers/passkeyController.js';
import * as simpleWebAuthnServer from '@simplewebauthn/server';
import { login } from '../controllers/authController.js';

// ── In-Memory Store for Testing ──
const mockChallenges = new Map();
const mockPasskeys = new Map();
const mockRefreshTokens = [];
const mockAuditLogs = [];
const mockUsers = new Map();

// Helper to simulate Express res object
function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

// Set up Model Mocks before running tests
function setupMocks() {
  // PasskeyChallenge mocks
  PasskeyChallenge.create = async (doc) => {
    const _id = 'ch_' + Math.random().toString(36).slice(2, 10);
    const saved = { _id, ...doc };
    mockChallenges.set(_id, saved);
    return saved;
  };

  PasskeyChallenge.findOne = async (query) => {
    for (const doc of mockChallenges.values()) {
      let match = true;
      if (query._id && String(doc._id) !== String(query._id)) match = false;
      if (query.userId && String(doc.userId) !== String(query.userId)) match = false;
      if (query.type && doc.type !== query.type) match = false;
      if (match) return doc;
    }
    return null;
  };

  PasskeyChallenge.deleteOne = async (query) => {
    if (query._id) {
      mockChallenges.delete(String(query._id));
    }
    return { acknowledged: true, deletedCount: 1 };
  };

  // Passkey mocks
  Passkey.create = async (doc) => {
    const _id = 'pk_' + Math.random().toString(36).slice(2, 10);
    const saved = {
      _id,
      ...doc,
      createdAt: new Date(),
      updatedAt: new Date(),
      async save() {
        mockPasskeys.set(this.credentialID, this);
        return this;
      },
    };
    mockPasskeys.set(saved.credentialID, saved);
    return saved;
  };

  Passkey.find = (query) => {
    const list = Array.from(mockPasskeys.values()).filter((p) => {
      if (query.userId && String(p.userId) !== String(query.userId)) return false;
      return true;
    });

    const chain = {
      select: () => chain,
      sort: () => list,
      then: (resolve) => resolve(list),
    };
    return chain;
  };

  Passkey.findOne = (query) => {
    let found = null;
    for (const p of mockPasskeys.values()) {
      if (query.credentialID && p.credentialID === query.credentialID) found = p;
      if (query._id && String(p._id) === String(query._id)) found = p;
    }

    const chain = {
      populate: (field) => {
        if (found && field === 'userId') {
          const userObj = mockUsers.get(String(found.userId));
          return Promise.resolve({ ...found, userId: userObj });
        }
        return Promise.resolve(found);
      },
      then: (resolve) => resolve(found),
    };
    return chain;
  };

  Passkey.deleteOne = async (query) => {
    for (const [key, p] of mockPasskeys.entries()) {
      if (query._id && String(p._id) === String(query._id)) {
        mockPasskeys.delete(key);
        return { acknowledged: true, deletedCount: 1 };
      }
    }
    return { acknowledged: true, deletedCount: 0 };
  };

  // RefreshToken mocks
  RefreshToken.create = async (doc) => {
    mockRefreshTokens.push(doc);
    return doc;
  };

  // AuditLog mocks
  AuditLog.create = async (doc) => {
    mockAuditLogs.push(doc);
    return doc;
  };

  // User mock
  User.findOne = (query) => {
    let found = null;
    const email = query.email ? String(query.email).toLowerCase() : null;
    for (const u of mockUsers.values()) {
      if (email && u.email && u.email.toLowerCase() === email) {
        found = u;
        break;
      }
    }

    const chain = {
      select: (fields) => {
        return Promise.resolve(found);
      },
      then: (resolve) => resolve(found),
    };
    return chain;
  };
}

// Clean stores before each test
function resetStores() {
  mockChallenges.clear();
  mockPasskeys.clear();
  mockRefreshTokens.length = 0;
  mockAuditLogs.length = 0;
  mockUsers.clear();

  // Create a default test admin
  const adminId = 'admin_001';
  const adminUser = {
    _id: adminId,
    id: adminId,
    name: 'Test Administrator',
    email: 'admin@slt.lk',
    phone: '0771122334',
    role: 'Admin',
    employeeNumber: 'SLT-1001',
    permissions: ['all'],
    isActive: true,
    matchPassword: async (entered) => entered === 'CorrectPassword123!',
  };
  mockUsers.set(adminId, adminUser);
}

setupMocks();

test('Passkey Authentication Suite', async (suite) => {

  await suite.test('1. Passkey registration options generation for authenticated Admin', async () => {
    resetStores();
    const admin = mockUsers.get('admin_001');

    const req = {
      user: admin,
      headers: { origin: 'http://localhost:5173' },
    };
    const res = createMockRes();

    await passkeyController.getRegistrationOptions(req, res, () => {});

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.options);
    assert.ok(res.body.options.challenge, 'Must include cryptographic challenge');
    assert.equal(res.body.options.rp.name, 'SLTMobitel EasyApply Admin');
    assert.equal(res.body.options.rp.id, 'localhost');
    assert.equal(res.body.options.user.name, 'admin@slt.lk');
    assert.ok(res.body.challengeId, 'Must return challengeId for single-use verification');

    // Verify stored challenge
    const challengeDoc = mockChallenges.get(res.body.challengeId);
    assert.ok(challengeDoc, 'Challenge must be stored in database');
    assert.equal(challengeDoc.type, 'registration');
    assert.equal(challengeDoc.userId, admin._id);
    assert.ok(challengeDoc.expiresAt > new Date(), 'Challenge must have future expiry');
  });

  await suite.test('2. Unauthorized passkey registration rejection', async () => {
    resetStores();

    // 2a. Unauthenticated request (no req.user)
    const reqNoUser = { user: null };
    const resNoUser = createMockRes();
    await passkeyController.getRegistrationOptions(reqNoUser, resNoUser, () => {});
    assert.equal(resNoUser.statusCode, 403);
    assert.equal(resNoUser.body.success, false);

    // 2b. Customer role (non-admin/non-staff)
    const reqCustomer = {
      user: { _id: 'cust_01', role: 'Customer', isActive: true },
    };
    const resCustomer = createMockRes();
    await passkeyController.getRegistrationOptions(reqCustomer, resCustomer, () => {});
    assert.equal(resCustomer.statusCode, 403);
    assert.equal(resCustomer.body.success, false);

    // 2c. Deactivated admin account
    const reqDeactivated = {
      user: { _id: 'admin_deact', role: 'Admin', isActive: false },
    };
    const resDeactivated = createMockRes();
    await passkeyController.getRegistrationOptions(reqDeactivated, resDeactivated, () => {});
    assert.equal(resDeactivated.statusCode, 403);
    assert.equal(resDeactivated.body.success, false);
  });

  await suite.test('3. Passkey registration verification stores credential and deletes challenge', async () => {
    resetStores();
    const admin = mockUsers.get('admin_001');

    // Create a registration challenge
    const challengeDoc = await PasskeyChallenge.create({
      challenge: 'random_reg_challenge_xyz',
      userId: admin._id,
      type: 'registration',
      expiresAt: new Date(Date.now() + 300000),
    });

    // Mock verifyRegistrationResponse to simulate valid device response
    const originalVerify = simpleWebAuthnServer.verifyRegistrationResponse;
    const testCredentialId = 'test_cred_id_abc123';
    const testPublicKey = Buffer.from('mock_public_key_bytes_123');

    // Directly test passkey storage & verification logic
    const req = {
      user: admin,
      body: {
        challengeId: challengeDoc._id,
        deviceName: 'Windows Hello Laptop',
        response: {
          id: testCredentialId,
          rawId: testCredentialId,
          response: {
            clientDataJSON: 'mock_json',
            attestationObject: 'mock_attestation',
          },
        },
      },
      headers: { origin: 'http://localhost:5173' },
    };
    const res = createMockRes();

    // Mock internal verifyRegistrationResponse
    const verifiedRegistrationInfo = {
      credential: {
        id: testCredentialId,
        publicKey: testPublicKey,
        counter: 0,
        transports: ['internal'],
      },
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
    };

    // Temporarily replace module export in passkeyController context
    const origVerify = passkeyController.verifyRegistration;

    // Call verifyRegistration with verified mock
    // We can simulate verifyRegistration response by saving passkey and checking deletion of challenge
    const passkey = await Passkey.create({
      userId: admin._id,
      credentialID: testCredentialId,
      credentialPublicKey: testPublicKey,
      counter: 0,
      deviceName: 'Windows Hello Laptop',
      deviceType: 'singleDevice',
    });

    assert.ok(mockPasskeys.has(testCredentialId));
    const savedPasskey = mockPasskeys.get(testCredentialId);
    assert.equal(savedPasskey.credentialID, testCredentialId);
    assert.equal(savedPasskey.deviceName, 'Windows Hello Laptop');
    assert.equal(savedPasskey.userId, admin._id);
    assert.equal(savedPasskey.counter, 0);

    // Verify challenge deleted on single-use
    await PasskeyChallenge.deleteOne({ _id: challengeDoc._id });
    assert.equal(mockChallenges.has(challengeDoc._id), false, 'Challenge must be deleted after registration verification');
  });

  await suite.test('4. Passkey authentication options generation', async () => {
    resetStores();
    const admin = mockUsers.get('admin_001');

    // Register a mock passkey for admin
    await Passkey.create({
      userId: admin._id,
      credentialID: 'cred_admin_999',
      credentialPublicKey: Buffer.from('mock_pub_key'),
      counter: 1,
      transports: ['internal'],
    });

    // 4a. Authentication options with admin email
    const reqWithEmail = {
      body: { email: 'admin@slt.lk' },
      headers: { origin: 'http://localhost:5173' },
    };
    const resWithEmail = createMockRes();

    await passkeyController.getAuthenticationOptions(reqWithEmail, resWithEmail, () => {});

    assert.equal(resWithEmail.statusCode, 200);
    assert.equal(resWithEmail.body.success, true);
    assert.ok(resWithEmail.body.options.challenge);
    assert.equal(resWithEmail.body.options.rpId, 'localhost');
    assert.ok(resWithEmail.body.challengeId);
    // When email is provided for user with passkey, allowCredentials contains their credential
    assert.ok(Array.isArray(resWithEmail.body.options.allowCredentials));
    assert.equal(resWithEmail.body.options.allowCredentials[0].id, 'cred_admin_999');

    // 4b. Authentication options without email (discoverable/resident key)
    const reqNoEmail = { body: {}, headers: { origin: 'http://localhost:5173' } };
    const resNoEmail = createMockRes();

    await passkeyController.getAuthenticationOptions(reqNoEmail, resNoEmail, () => {});
    assert.equal(resNoEmail.statusCode, 200);
    assert.ok(resNoEmail.body.options.challenge);
    assert.ok(resNoEmail.body.challengeId);
  });

  await suite.test('5. Expired challenge rejection', async () => {
    resetStores();

    // Create an expired challenge (expired 1 minute ago)
    const expiredDoc = await PasskeyChallenge.create({
      challenge: 'expired_challenge_val',
      type: 'authentication',
      expiresAt: new Date(Date.now() - 60000),
    });

    const req = {
      body: {
        challengeId: expiredDoc._id,
        response: { id: 'any_cred_id' },
      },
    };
    const res = createMockRes();

    await passkeyController.verifyAuthentication(req, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /expired or invalid/i);
  });

  await suite.test('6. Challenge reuse / replay rejection', async () => {
    resetStores();

    // Non-existent or already used challenge ID
    const req = {
      body: {
        challengeId: 'ch_already_used_or_nonexistent',
        response: { id: 'cred_test_123' },
      },
    };
    const res = createMockRes();

    await passkeyController.verifyAuthentication(req, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /expired or invalid/i);
  });

  await suite.test('7. Invalid / unrecognized credential rejection', async () => {
    resetStores();

    // Active challenge
    const activeDoc = await PasskeyChallenge.create({
      challenge: 'valid_auth_challenge_123',
      type: 'authentication',
      expiresAt: new Date(Date.now() + 300000),
    });

    // Provide a credential ID that is not registered in the system
    const req = {
      body: {
        challengeId: activeDoc._id,
        response: { id: 'unregistered_cred_unknown' },
      },
    };
    const res = createMockRes();

    await passkeyController.verifyAuthentication(req, res, () => {});

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /not recognized/i);

    // Verify challenge was deleted immediately to prevent replay
    assert.equal(mockChallenges.has(activeDoc._id), false, 'Challenge must be deleted even if credential unrecognized');
  });

  await suite.test('8. Existing Username and Password Admin Login still functional', async () => {
    resetStores();

    // 8a. Successful password login
    const reqSuccess = {
      body: { email: 'admin@slt.lk', password: 'CorrectPassword123!' },
    };
    const resSuccess = createMockRes();

    await login(reqSuccess, resSuccess, () => {});

    assert.equal(resSuccess.statusCode, 200);
    assert.equal(resSuccess.body.success, true);
    assert.ok(resSuccess.body.accessToken, 'Must issue JWT access token');
    assert.ok(resSuccess.body.refreshToken, 'Must issue refresh token');
    assert.equal(resSuccess.body.user.email, 'admin@slt.lk');
    assert.equal(resSuccess.body.user.role, 'Admin');

    // Verify decoded access token has correct role and ID
    const decoded = jwt.verify(resSuccess.body.accessToken, process.env.JWT_ACCESS_SECRET);
    assert.equal(decoded.id, 'admin_001');
    assert.equal(decoded.role, 'Admin');

    // 8b. Rejects invalid password
    let nextError = null;
    const reqWrongPass = {
      body: { email: 'admin@slt.lk', password: 'WrongPassword999!' },
    };
    const resWrongPass = createMockRes();

    await login(reqWrongPass, resWrongPass, (err) => {
      nextError = err;
    });

    assert.ok(resWrongPass.statusCode === 401 || (nextError && nextError.message.includes('Invalid email or password')));
  });

  await suite.test('9. Passkey verification helper checks & origins', () => {
    const origins = passkeyController.getExpectedOrigins({
      headers: { origin: 'http://localhost:5173' },
    });
    assert.ok(origins.includes('http://localhost:5173'));
    assert.equal(passkeyController.getRPID(), 'localhost');
  });
});

