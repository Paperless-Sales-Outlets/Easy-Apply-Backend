import jwt from 'jsonwebtoken';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoUint8Array } from '@simplewebauthn/server/helpers';
import Passkey from '../models/Passkey.js';
import PasskeyChallenge from '../models/PasskeyChallenge.js';
import User from '../models/User.js';
import RefreshToken from '../models/RefreshToken.js';
import { recordAudit } from '../services/auditService.js';
import {
  generateAccessToken,
  generateRefreshToken,
  publicStaff,
} from './authController.js';

/**
 * Resolve the Relying Party ID (hostname without scheme/port).
 */
export const getRPID = () => {
  return process.env.WEBAUTHN_RP_ID || 'localhost';
};

/**
 * Resolve the Relying Party human-readable name.
 */
export const getRPName = () => {
  return process.env.WEBAUTHN_RP_NAME || 'SLTMobitel EasyApply Admin';
};

/**
 * Resolve the allowed origins for WebAuthn ceremony verification.
 */
export const getExpectedOrigins = (req) => {
  const custom = process.env.WEBAUTHN_ORIGIN;
  const origins = [];

  if (custom) {
    custom.split(',').forEach((o) => {
      const trimmed = o.trim();
      if (trimmed && !origins.includes(trimmed)) origins.push(trimmed);
    });
  }

  const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
  frontend.split(',').forEach((o) => {
    const trimmed = o.trim();
    if (trimmed && !origins.includes(trimmed)) origins.push(trimmed);
  });

  if (process.env.NODE_ENV !== 'production') {
    ['http://localhost:5173', 'http://localhost:3000'].forEach((dev) => {
      if (!origins.includes(dev)) origins.push(dev);
    });
  }

  // If request comes with an Origin header matching allowed local or configured origins
  if (req?.headers?.origin && origins.includes(req.headers.origin)) {
    return origins;
  }

  return origins.length > 0 ? origins : ['http://localhost:5173'];
};

/**
 * Check if the user has permission to manage or authenticate via admin passkeys.
 */
const isAuthorizedAdminOrStaff = (user) => {
  if (!user || user.isActive === false) return false;
  // Customer role is never permitted in admin portal
  return Boolean(user.role && user.role !== 'Customer');
};

/**
 * @desc    Generate passkey registration options for an authenticated administrator
 * @route   GET /api/auth/passkey/registration-options
 * @access  Private (Admin / Staff)
 */
export const getRegistrationOptions = async (req, res, next) => {
  try {
    const user = req.user;
    if (!isAuthorizedAdminOrStaff(user)) {
      return res.status(403).json({
        success: false,
        message: 'Only authorized administrators and staff may register passkeys.',
      });
    }

    // Retrieve already registered passkeys to prevent duplicate registrations
    const existingPasskeys = await Passkey.find({ userId: user._id });

    const rpID = getRPID();
    const rpName = getRPName();

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: isoUint8Array.fromUTF8String(String(user._id)),
      userName: user.email || user.employeeNumber || String(user._id),
      userDisplayName: user.name || 'Admin',
      attestationType: 'none',
      excludeCredentials: existingPasskeys.map((pk) => ({
        id: pk.credentialID,
        transports: pk.transports || [],
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // Challenges are stored securely in database, short-lived (5 min), single-use
    const challengeDoc = await PasskeyChallenge.create({
      challenge: options.challenge,
      userId: user._id,
      type: 'registration',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    return res.status(200).json({
      success: true,
      options,
      challengeId: challengeDoc._id,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Verify passkey registration response and store credential
 * @route   POST /api/auth/passkey/verify-registration
 * @access  Private (Admin / Staff)
 */
export const verifyRegistration = async (req, res, next) => {
  try {
    const user = req.user;
    if (!isAuthorizedAdminOrStaff(user)) {
      return res.status(403).json({
        success: false,
        message: 'Only authorized administrators and staff may register passkeys.',
      });
    }

    const { response, challengeId, deviceName } = req.body;
    if (!response || !challengeId) {
      return res.status(400).json({
        success: false,
        message: 'Registration response and challengeId are required.',
      });
    }

    // Retrieve challenge record
    const challengeDoc = await PasskeyChallenge.findOne({
      _id: challengeId,
      userId: user._id,
      type: 'registration',
    });

    if (!challengeDoc || challengeDoc.expiresAt < new Date()) {
      if (challengeDoc) {
        await PasskeyChallenge.deleteOne({ _id: challengeDoc._id });
      }
      return res.status(400).json({
        success: false,
        message: 'Registration challenge has expired or is invalid. Please try again.',
      });
    }

    // Single-use: delete immediately to prevent reuse
    await PasskeyChallenge.deleteOne({ _id: challengeDoc._id });

    const rpID = getRPID();
    const expectedOrigin = getExpectedOrigins(req);

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeDoc.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({
        success: false,
        message: 'Passkey registration verification failed.',
      });
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    // Save passkey in DB securely (Never store private keys)
    const passkey = await Passkey.create({
      userId: user._id,
      credentialID: credential.id,
      credentialPublicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      deviceType: credentialDeviceType || 'singleDevice',
      backedUp: Boolean(credentialBackedUp),
      transports: credential.transports || response.response?.transports || [],
      deviceName: deviceName?.trim() || 'Passkey Device',
      lastUsedAt: new Date(),
    });

    await recordAudit({
      req,
      actor: user,
      action: 'CREATE',
      module: 'Authentication',
      targetId: passkey._id,
      description: `Registered passkey device: ${passkey.deviceName}`,
    });

    return res.status(201).json({
      success: true,
      message: 'Passkey registered successfully.',
      passkey: {
        id: passkey._id,
        credentialID: passkey.credentialID,
        deviceName: passkey.deviceName,
        deviceType: passkey.deviceType,
        createdAt: passkey.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    List registered passkeys for current authenticated administrator
 * @route   GET /api/auth/passkey/list
 * @access  Private (Admin / Staff)
 */
export const listPasskeys = async (req, res, next) => {
  try {
    const user = req.user;
    if (!isAuthorizedAdminOrStaff(user)) {
      return res.status(403).json({
        success: false,
        message: 'Access restricted to administrators and staff.',
      });
    }

    const passkeys = await Passkey.find({ userId: user._id })
      .select('_id deviceName deviceType backedUp transports lastUsedAt createdAt')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      passkeys,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a registered passkey for current administrator
 * @route   DELETE /api/auth/passkey/:id
 * @access  Private (Admin / Staff)
 */
export const deletePasskey = async (req, res, next) => {
  try {
    const user = req.user;
    if (!isAuthorizedAdminOrStaff(user)) {
      return res.status(403).json({
        success: false,
        message: 'Access restricted to administrators and staff.',
      });
    }

    const passkey = await Passkey.findOne({
      _id: req.params.id,
      userId: user._id,
    });

    if (!passkey) {
      return res.status(404).json({
        success: false,
        message: 'Passkey not found.',
      });
    }

    await Passkey.deleteOne({ _id: passkey._id });

    await recordAudit({
      req,
      actor: user,
      action: 'DELETE',
      module: 'Authentication',
      targetId: passkey._id,
      description: `Deleted passkey device: ${passkey.deviceName}`,
    });

    return res.status(200).json({
      success: true,
      message: 'Passkey removed successfully.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Generate passkey authentication options for Admin Login
 * @route   POST /api/auth/passkey/login-options
 * @access  Public
 */
export const getAuthenticationOptions = async (req, res, next) => {
  try {
    const { email } = req.body || {};
    let allowCredentials = undefined;
    let targetUser = null;

    if (email && typeof email === 'string' && email.trim()) {
      const cleanEmail = email.trim().toLowerCase();
      targetUser = await User.findOne({ email: cleanEmail });

      if (targetUser) {
        if (targetUser.isActive === false) {
          return res.status(403).json({
            success: false,
            message: 'This account has been deactivated. Contact an administrator.',
          });
        }

        const userPasskeys = await Passkey.find({ userId: targetUser._id });
        if (userPasskeys.length > 0) {
          allowCredentials = userPasskeys.map((pk) => ({
            id: pk.credentialID,
            transports: pk.transports || [],
          }));
        }
      }
    }

    const rpID = getRPID();

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'preferred',
    });

    const challengeDoc = await PasskeyChallenge.create({
      challenge: options.challenge,
      userId: targetUser ? targetUser._id : undefined,
      type: 'authentication',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    return res.status(200).json({
      success: true,
      options,
      challengeId: challengeDoc._id,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Verify passkey authentication response and log in administrator
 * @route   POST /api/auth/passkey/login-verify
 * @access  Public
 */
export const verifyAuthentication = async (req, res, next) => {
  try {
    const { response, challengeId } = req.body || {};

    if (!response || !challengeId) {
      return res.status(400).json({
        success: false,
        message: 'Authentication response and challengeId are required.',
      });
    }

    // Retrieve challenge record
    const challengeDoc = await PasskeyChallenge.findOne({
      _id: challengeId,
      type: 'authentication',
    });

    if (!challengeDoc || challengeDoc.expiresAt < new Date()) {
      if (challengeDoc) {
        await PasskeyChallenge.deleteOne({ _id: challengeDoc._id });
      }
      return res.status(400).json({
        success: false,
        message: 'Authentication challenge expired or invalid. Please try again.',
      });
    }

    // Single-use: delete immediately to prevent replay attacks
    await PasskeyChallenge.deleteOne({ _id: challengeDoc._id });

    // Look up passkey credential by credential ID
    const passkey = await Passkey.findOne({ credentialID: response.id }).populate('userId');

    if (!passkey || !passkey.userId) {
      return res.status(401).json({
        success: false,
        message: 'Passkey not recognized. Please sign in with username and password first to register this device.',
      });
    }

    const user = passkey.userId;

    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'This account has been deactivated. Contact an administrator.',
      });
    }

    if (!isAuthorizedAdminOrStaff(user)) {
      return res.status(403).json({
        success: false,
        message: 'Passkey sign-in is restricted to administrative staff.',
      });
    }

    const rpID = getRPID();
    const expectedOrigin = getExpectedOrigins(req);

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeDoc.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: {
        id: passkey.credentialID,
        publicKey: new Uint8Array(passkey.credentialPublicKey),
        counter: passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      return res.status(401).json({
        success: false,
        message: 'Passkey authentication verification failed.',
      });
    }

    // Update credential counter and last used timestamp
    passkey.counter = verification.authenticationInfo.newCounter;
    passkey.lastUsedAt = new Date();
    await passkey.save();

    // Generate tokens matching existing password login
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Persist refresh token in DB
    const decodedRefresh = jwt.decode(refreshToken);
    await RefreshToken.create({
      userId: user._id,
      token: refreshToken,
      expiresAt: new Date(decodedRefresh.exp * 1000),
    });

    const publicProfile = publicStaff(user);

    await recordAudit({
      req,
      actor: user,
      action: 'LOGIN',
      module: 'Authentication',
      targetId: user._id,
      description: `Successful passkey login (${passkey.deviceName})`,
    });

    return res.status(200).json({
      success: true,
      user: publicProfile,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
};
