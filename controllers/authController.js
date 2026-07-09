import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Otp from '../models/Otp.js';
import RefreshToken from '../models/RefreshToken.js';

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
    { id: user._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
  );
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
  const { name, email, phone, role, NIC, password } = req.body;

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
      name,
      email,
      phone,
      role: role || 'Customer',
      NIC,
      password,
    });

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
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        NIC: user.NIC,
      },
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
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        NIC: user.NIC,
      },
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
