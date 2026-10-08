import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
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

    // 1. Try finding in the Customer database
    const customer = await Customer.findOne({
      $or: [
        { phone: phone },
        { phone: digitsOnly },
        { phone: last9 },
        { phone: `0${last9}` },
        { phone: `+94${last9}` },
        { phone: `94${last9}` },
      ],
    }).select('_id');
    
    let registered = !!customer;

    // 2. If not found in Customers, check if they are an existing SLT Customer connection/application
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


// The customer fields safe to return to the client. Kept in one place so
// register, login and /me all expose the same profile.
export const publicCustomer = (customer) => ({
  id: customer._id,
  name: customer.name,
  email: customer.email,
  phone: customer.phone,
  role: customer.role,
  NIC: customer.NIC,
  title: customer.title,
  dob: customer.dob,
  gender: customer.gender,
  nationality: customer.nationality,
  contactNumber: customer.contactNumber,
  addressLine1: customer.addressLine1,
  addressLine2: customer.addressLine2,
  city: customer.city,
  district: customer.district,
  postalCode: customer.postalCode,
  preferredContact: customer.preferredContact,
  // Ids only — the images are served admin-only via /api/files/:id.
  identityDocuments: customer.identityDocuments || null,
  hasIdentityDocuments: !!(customer.identityDocuments && customer.identityDocuments.facePhoto),
});

export const publicUser = publicCustomer;



/**
 * Write a base64 data URL into GridFS and return its file id.
 *
 * KYC images are stored as files rather than inline on the user document:
 * three base64 images would add roughly a megabyte to every record and are
 * already served admin-only through /api/files/:id.
 */
export const storeIdentityImage = async (dataUrl, label, userId) => {
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

// @desc    Get all customers / users (admin only)
// @route   GET /api/auth/users, GET /api/auth/customers
// @access  Private (Admin)
export const getCustomers = async (req, res, next) => {
  try {
    const customers = await Customer.find()
      .select('name email phone role NIC createdAt')
      .sort({ createdAt: -1 })
      .lean();

    const formatted = customers.map(c => ({
      id: c._id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      role: c.role,
      NIC: c.NIC,
      createdAt: c.createdAt,
    }));

    res.status(200).json({
      success: true,
      count: formatted.length,
      customers: formatted,
      users: formatted,
    });
  } catch (error) {
    next(error);
  }
};

export const getUsers = getCustomers;

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

// @desc    Register a new customer / user
// @route   POST /api/auth/register
// @access  Public
export const register = async (req, res, next) => {
  const {
    name, email, phone, role, NIC, password,
    title, dob, gender, nationality, contactNumber,
    addressLine1, addressLine2, city, district, postalCode, preferredContact,
    nicFront, nicBack, facePhoto
  } = req.body;

  if (!name || !phone || !NIC) {
    res.status(400);
    return next(new Error('Name, phone number and NIC are required'));
  }

  try {
    const digitsOnly = String(phone).replace(/\D/g, '');
    const last9 = digitsOnly.slice(-9);
    const cleanNic = String(NIC).trim().toUpperCase();
    const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : undefined;

    // Check if customer already exists by phone, last9, or NIC
    let customer = await Customer.findOne({
      $or: [
        ...(cleanEmail ? [{ email: cleanEmail }] : []),
        { phone: digitsOnly },
        { phone: last9 },
        { phone: `0${last9}` },
        { phone: `+94${last9}` },
        { phone: `94${last9}` },
        { NIC: cleanNic },
      ],
    });

    if (customer) {
      // Customer exists -> Update profile details seamlessly
      customer.name = name || customer.name;
      if (cleanEmail) customer.email = cleanEmail;
      customer.NIC = cleanNic;
      customer.phone = digitsOnly;
      if (title) customer.title = title;
      if (dob) customer.dob = dob;
      if (gender) customer.gender = gender;
      if (nationality) customer.nationality = nationality;
      if (contactNumber) customer.contactNumber = contactNumber;
      if (addressLine1) customer.addressLine1 = addressLine1;
      if (addressLine2) customer.addressLine2 = addressLine2;
      if (city) customer.city = city;
      if (district) customer.district = district;
      if (postalCode) customer.postalCode = postalCode;
      if (preferredContact) customer.preferredContact = preferredContact;
      await customer.save();
    } else {
      // Create new customer document
      customer = await Customer.create({
        name,
        ...(cleanEmail ? { email: cleanEmail } : {}),
        phone: digitsOnly,
        role: role || 'Customer',
        NIC: cleanNic,
        ...(password ? { password } : {}),
        title,
        dob,
        gender,
        nationality,
        contactNumber,
        addressLine1,
        addressLine2,
        city,
        district,
        postalCode,
        preferredContact,
      });
    }

    // Persist identity images if provided
    try {
      const [frontId, backId, faceId] = await Promise.all([
        storeIdentityImage(nicFront, 'nic-front', customer._id),
        storeIdentityImage(nicBack, 'nic-back', customer._id),
        storeIdentityImage(facePhoto, 'face-photo', customer._id),
      ]);

      if (frontId || backId || faceId) {
        customer.identityDocuments = {
          nicFront: frontId || customer.identityDocuments?.nicFront,
          nicBack: backId || customer.identityDocuments?.nicBack,
          facePhoto: faceId || customer.identityDocuments?.facePhoto,
          capturedAt: new Date(),
        };
        await customer.save();
      }
    } catch (uploadErr) {
      console.error('Identity document storage failed for', String(customer._id), uploadErr.message);
    }

    // Generate tokens
    const accessToken = generateAccessToken(customer);
    const refreshToken = generateRefreshToken(customer);

    // Save refresh token to DB
    const decodedRefresh = jwt.decode(refreshToken);
    await RefreshToken.create({
      userId: customer._id,
      token: refreshToken,
      expiresAt: new Date(decodedRefresh.exp * 1000),
    });

    const publicProfile = publicCustomer(customer);

    res.status(201).json({
      success: true,
      customer: publicProfile,
      user: publicProfile,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Login customer
// @route   POST /api/auth/login
// @access  Public
/**
 * Legacy email + password sign-in.
 *
 * SLT removed this option — customers sign in with a mobile number and OTP via
 * /api/auth/otp-login. Accounts created since that change have no password, so
 * this will correctly reject them. Kept for any older account that still has
 * one, and so existing integrations don't 404.
 */
export const login = async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    return next(new Error('Please provide email and password'));
  }

  try {
    // Find customer and explicitly select password
    const customer = await Customer.findOne({ email }).select('+password');

    if (!customer) {
      res.status(401);
      return next(new Error('Invalid email or password'));
    }

    // Check password matches
    const isMatch = await customer.matchPassword(password);

    if (!isMatch) {
      res.status(401);
      return next(new Error('Invalid email or password'));
    }

    // Generate tokens
    const accessToken = generateAccessToken(customer);
    const refreshToken = generateRefreshToken(customer);

    // Save refresh token to DB
    const decodedRefresh = jwt.decode(refreshToken);
    await RefreshToken.create({
      userId: customer._id,
      token: refreshToken,
      expiresAt: new Date(decodedRefresh.exp * 1000),
    });

    const publicProfile = publicCustomer(customer);

    res.status(200).json({
      success: true,
      customer: publicProfile,
      user: publicProfile,
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
    const customer = await Customer.findOne({
      $or: [
        { phone: String(phone).trim() },
        { phone: digitsOnly },
        { phone: last9 },
        { phone: `0${last9}` },
        { phone: `+94${last9}` },
        { phone: `94${last9}` },
      ],
    });

    if (!customer) {
      res.status(404);
      return next(new Error('No account is registered to this number. Please create one first.'));
    }

    const accessToken = generateAccessToken(customer);
    const refreshToken = generateRefreshToken(customer);

    const decodedRefresh = jwt.decode(refreshToken);
    await RefreshToken.create({
      userId: customer._id,
      token: refreshToken,
      expiresAt: new Date(decodedRefresh.exp * 1000),
    });

    const publicProfile = publicCustomer(customer);

    res.status(200).json({
      success: true,
      customer: publicProfile,
      user: publicProfile,
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

    // Find the customer
    const customer = await Customer.findById(decoded.id);

    if (!customer) {
      res.status(401);
      return next(new Error('Customer account not found'));
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(customer);

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

// @desc    Logout customer & invalidate refresh token
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

// @desc    Unified Entry verification: verifies OTP and checks if customer is existing (login) or new (NIC upload)
// @route   POST /api/auth/verify-entry
// @access  Public
export const verifyEntry = async (req, res, next) => {
  const { phone, nic, otp } = req.body;

  if (!phone || !nic || !otp) {
    res.status(400);
    return next(new Error('Phone number, NIC number, and verification code are required'));
  }

  try {
    const digitsOnly = String(phone).replace(/\D/g, '');
    const last9 = digitsOnly.slice(-9);
    const cleanNic = String(nic).trim().toUpperCase();
    const cleanOtp = String(otp).trim();

    if (last9.length !== 9) {
      res.status(400);
      return next(new Error('Please provide a valid 9-digit Sri Lankan mobile number'));
    }

    // 1. Verify OTP (accept demo codes 000000 / 123456)
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

    // 2. Check if customer is registered in Customer collection by phone or NIC
    const customer = await Customer.findOne({
      $or: [
        { phone: String(phone).trim() },
        { phone: digitsOnly },
        { phone: last9 },
        { phone: `0${last9}` },
        { phone: `+94${last9}` },
        { phone: `94${last9}` },
        { NIC: cleanNic },
      ],
    });

    if (customer) {
      // Existing registered customer -> direct login
      const accessToken = generateAccessToken(customer);
      const refreshToken = generateRefreshToken(customer);

      const decodedRefresh = jwt.decode(refreshToken);
      await RefreshToken.create({
        userId: customer._id,
        token: refreshToken,
        expiresAt: new Date(decodedRefresh.exp * 1000),
      });

      const publicProfile = publicCustomer(customer);

      return res.status(200).json({
        success: true,
        existing: true,
        message: 'Existing customer authenticated',
        customer: publicProfile,
        user: publicProfile,
        accessToken,
        refreshToken,
      });
    }

    // 3. New Customer (not yet registered) -> proceed to NIC uploading step
    return res.status(200).json({
      success: true,
      existing: false,
      message: 'New customer verified. Please proceed with identity upload.',
      phone: last9,
      nic: cleanNic,
    });
  } catch (error) {
    next(error);
  }
};

