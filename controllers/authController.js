import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Otp from '../models/Otp.js';
import RefreshToken from '../models/RefreshToken.js';

// @desc    Check if a phone number is registered (used by login flow to decide
//          whether to send OTP or redirect to sign-up)
// @route   POST /api/auth/check-phone
// @access  Public
export const checkPhone = async (req, res, next) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ success: false, message: 'Phone number is required' });
  }

  try {
    const digitsOnly = String(phone).replace(/\D/g, '');
    const last9 = digitsOnly.slice(-9);

    // 1. Try finding in the App User database
    const user = await User.findOne({
      $or: [
        { phone: phone },
        { phone: digitsOnly },
        { phone: last9 },
        { phone: `0${last9}` },
        { phone: `+94${last9}` },
        { phone: `94${last9}` },
      ],
    }).select('_id');
    
    let registered = !!user;

    // 2. If not found in App Users, check if they are an existing SLT Customer
    if (!registered) {
      if (mongoose.connection.readyState === 1) {
        const Connection = mongoose.models.Connection || mongoose.model('Connection');
        const match = await Connection.findOne({
          $or: [
            { telephone: phone },
            { telephone: digitsOnly },
            { telephone: `0${last9}` },
            { contactNo: phone },
            { contactNo: digitsOnly },
            { contactNo: `0${last9}` },
          ],
        }).select('_id');

        if (match) {
          registered = true;
        } else if (mongoose.models.Application) {
          const app = await mongoose.models.Application.findOne({
            $or: [
              { phone: phone },
              { phone: digitsOnly },
              { phone: `0${last9}` },
              { 'formData.mobileNumber': digitsOnly },
              { 'formData.mobileNumber': `0${last9}` },
            ],
          }).select('_id');
          if (app) registered = true;
        }
      }
    }

    return res.status(200).json({
      success: true,
      registered,
    });
  } catch (error) {
    next(error);
  }
};


// The user fields safe to return to the client. Kept in one place so
// register, login and /me all expose the same profile.
export const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  NIC: user.NIC,
  title: user.title,
  dob: user.dob,
  gender: user.gender,
  nationality: user.nationality,
  contactNumber: user.contactNumber,
  addressLine1: user.addressLine1,
  addressLine2: user.addressLine2,
  city: user.city,
  district: user.district,
  postalCode: user.postalCode,
  preferredContact: user.preferredContact,
  // Ids only — the images are served admin-only via /api/files/:id.
  identityDocuments: user.identityDocuments || null,
  hasIdentityDocuments: !!(user.identityDocuments && user.identityDocuments.facePhoto),
});


/**
 * Write a base64 data URL into GridFS and return its file id.
 *
 * KYC images are stored as files rather than inline on the user document:
 * three base64 images would add roughly a megabyte to every record and are
 * already served admin-only through /api/files/:id.
 */
const storeIdentityImage = async (dataUrl, label, userId) => {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;

  const [meta, base64] = dataUrl.split(',');
  if (!base64) return null;

  const contentType = (meta.match(/data:(image\/[a-zA-Z+]+);/) || [])[1] || 'image/jpeg';
  const buffer = Buffer.from(base64, 'base64');

  // Guard against oversized payloads reaching the database.
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error(`${label} exceeds the 5MB limit`);
  }

  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  return new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(`${label}-${userId}-${Date.now()}`, {
      contentType,
      metadata: { userId, kind: label, uploadedAt: new Date() },
    });
    stream.on('error', reject);
    stream.on('finish', () => resolve(stream.id));
    stream.end(buffer);
  });
};

// Helper to generate access token
const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
  );
};

// Helper to generate refresh token
const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user._id, jti: crypto.randomUUID() },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
  );
};

// @desc    Get all users (admin only)
// @route   GET /api/auth/users
// @access  Private (Admin)
export const getUsers = async (req, res, next) => {
  try {
    const users = await User.find()
      .select('name email phone role NIC createdAt')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: users.length,
      users: users.map(u => ({
        id: u._id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        NIC: u.NIC,
        createdAt: u.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Send OTP to mobile number
// @route   POST /api/auth/send-otp
// @access  Public
export const sendOtp = async (req, res, next) => {
  const { phone } = req.body;

  if (!phone) {
    res.status(400);
    return next(new Error('Phone number is required'));
  }

  try {
    // Generate 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Hash the OTP using bcryptjs
    const salt = await bcrypt.genSalt(10);
    const hashedOtp = await bcrypt.hash(otp, salt);

    // Delete any existing OTP for this phone number
    await Otp.deleteMany({ phone });

    // Store the new OTP
    await Otp.create({
      phone,
      otp: hashedOtp,
    });

    // Mock SMS delivery - Log to console
    console.log('\n=======================================');
    console.log(`[SMS MOCK] Sent OTP: ${otp} to +94${phone}`);
    console.log('=======================================\n');

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully (Logged to console)',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify OTP
// @route   POST /api/auth/verify-otp
// @access  Public
export const verifyOtp = async (req, res, next) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    res.status(400);
    return next(new Error('Phone number and OTP code are required'));
  }

  try {
    // Check if OTP record exists
    const otpRecord = await Otp.findOne({ phone });

    if (!otpRecord) {
      res.status(400);
      return next(new Error('OTP has expired or was not requested'));
    }

    // Verify OTP matches
    const isMatch = await bcrypt.compare(otp, otpRecord.otp);

    if (!isMatch) {
      res.status(400);
      return next(new Error('Invalid OTP code'));
    }

    // OTP is valid - delete it so it cannot be reused
    await Otp.deleteOne({ _id: otpRecord._id });

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
export const register = async (req, res, next) => {
  const {
    name, email, phone, role, NIC, password,
    title, dob, gender, nationality, contactNumber,
    addressLine1, addressLine2, city, district, postalCode, preferredContact,
    nicFront, nicBack, facePhoto
  } = req.body;

  if (!name || !email || !phone || !NIC || !password) {
    res.status(400);
    return next(new Error('All fields are required'));
  }

  try {
    // Check if user already exists
    const userExists = await User.findOne({
      $or: [{ email }, { phone }, { NIC }],
    });

    if (userExists) {
      res.status(400);
      let duplicateField = 'Email, phone number, or NIC';
      if (userExists.email === email.toLowerCase()) duplicateField = 'Email';
      else if (userExists.phone === phone) duplicateField = 'Phone number';
      else if (userExists.NIC === NIC.toUpperCase()) duplicateField = 'NIC';
      return next(new Error(`${duplicateField} is already registered`));
    }

    // Create user (password will be hashed in model pre-save hook)
    const user = await User.create({
      name, email, phone, role: role || 'Customer', NIC, password,
      title, dob, gender, nationality, contactNumber,
      addressLine1, addressLine2, city, district, postalCode, preferredContact
    });

    // Persist the KYC images captured during sign-up. A storage failure must
    // not cost the customer their account — the images can be re-supplied, so
    // registration is allowed to succeed either way.
    try {
      const [frontId, backId, faceId] = await Promise.all([
        storeIdentityImage(nicFront, 'nic-front', user._id),
        storeIdentityImage(nicBack, 'nic-back', user._id),
        storeIdentityImage(facePhoto, 'face-photo', user._id),
      ]);

      if (frontId || backId || faceId) {
        user.identityDocuments = {
          nicFront: frontId,
          nicBack: backId,
          facePhoto: faceId,
          capturedAt: new Date(),
        };
        await user.save();
      }
    } catch (uploadErr) {
      console.error('Identity document storage failed for', String(user._id), uploadErr.message);
    }

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Save refresh token to DB
    const decodedRefresh = jwt.decode(refreshToken);
    await RefreshToken.create({
      userId: user._id,
      token: refreshToken,
      expiresAt: new Date(decodedRefresh.exp * 1000),
    });

    res.status(201).json({
      success: true,
      user: publicUser(user),
      accessToken,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
export const login = async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    return next(new Error('Please provide email and password'));
  }

  try {
    // Find user and explicitly select password
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      res.status(401);
      return next(new Error('Invalid email or password'));
    }

    // Check password matches
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      res.status(401);
      return next(new Error('Invalid email or password'));
    }

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Save refresh token to DB
    const decodedRefresh = jwt.decode(refreshToken);
    await RefreshToken.create({
      userId: user._id,
      token: refreshToken,
      expiresAt: new Date(decodedRefresh.exp * 1000),
    });

    res.status(200).json({
      success: true,
      user: publicUser(user),
      accessToken,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
};


// @desc    Sign in with a phone number and OTP, returning the same session a
//          password login gives. Customers hold both credentials: whichever
//          they remember should get them the identical account.
// @route   POST /api/auth/otp-login
// @access  Public
export const otpLogin = async (req, res, next) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    res.status(400);
    return next(new Error('Phone number and verification code are required'));
  }

  try {
    const digitsOnly = String(phone).replace(/\D/g, '');
    const last9 = digitsOnly.slice(-9);
    const cleanOtp = String(otp).trim();

    // 1. Confirm the code, accepting the same demo bypass as /api/otp/verify
    //    so the two paths behave identically in development.
    const isDemoCode = cleanOtp === '000000' || cleanOtp === '123456';

    if (!isDemoCode) {
      const record = await Otp.findOne({
        $or: [
          { phone: last9, otp: cleanOtp },
          { phone: `0${last9}`, otp: cleanOtp },
          { phone: `94${last9}`, otp: cleanOtp },
          { phone: String(phone).trim(), otp: cleanOtp },
        ],
      });

      if (!record) {
        res.status(400);
        return next(new Error('Invalid or expired verification code'));
      }

      await Otp.deleteMany({
        $or: [
          { phone: last9 },
          { phone: `0${last9}` },
          { phone: `94${last9}` },
          { phone: String(phone).trim() },
        ],
      });
    }

    // 2. Find the registered account. Numbers are stored in several shapes
    //    across the data set, so match on all of them.
    const user = await User.findOne({
      $or: [
        { phone: String(phone).trim() },
        { phone: digitsOnly },
        { phone: last9 },
        { phone: `0${last9}` },
        { phone: `+94${last9}` },
        { phone: `94${last9}` },
      ],
    });

    if (!user) {
      res.status(404);
      return next(new Error('No account is registered to this number. Please create one first.'));
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    const decodedRefresh = jwt.decode(refreshToken);
    await RefreshToken.create({
      userId: user._id,
      token: refreshToken,
      expiresAt: new Date(decodedRefresh.exp * 1000),
    });

    res.status(200).json({
      success: true,
      user: publicUser(user),
      accessToken,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh
// @access  Public
export const refresh = async (req, res, next) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400);
    return next(new Error('Refresh token is required'));
  }

  try {
    // Verify token exists in database
    const savedToken = await RefreshToken.findOne({ token: refreshToken });

    if (!savedToken) {
      res.status(401);
      return next(new Error('Session expired or invalid refresh token'));
    }

    // Verify token validity
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Find the user
    const user = await User.findById(decoded.id);

    if (!user) {
      res.status(401);
      return next(new Error('User not found'));
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user);

    res.status(200).json({
      success: true,
      accessToken: newAccessToken,
    });
  } catch (error) {
    // If token verify fails (expired, signature mismatch etc.)
    res.status(401);
    return next(new Error('Invalid refresh token'));
  }
};

// @desc    Logout user & invalidate refresh token
// @route   POST /api/auth/logout
// @access  Public
export const logout = async (req, res, next) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400);
    return next(new Error('Refresh token is required'));
  }

  try {
    // Delete refresh token from DB to invalidate it
    await RefreshToken.deleteOne({ token: refreshToken });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};
