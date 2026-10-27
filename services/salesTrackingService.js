import crypto from 'crypto';
import mongoose from 'mongoose';
import SalesOfficerQr from '../models/SalesOfficerQr.js';
import Application from '../models/Application.js';
import User from '../models/User.js';
import { escapeRegex } from '../utils/employeeNumber.js';

export const COMPLETED_SALE_DEFINITION =
  "An application is classified as a completed sale when its status is 'confirmed' (payment & appointment confirmed), status is 'completed' (installation verified), paymentStatus is 'paid', or completedSale is true.";

/**
 * Generates an opaque, unpredictable tracking token.
 */
export const generateTrackingToken = () => {
  return crypto.randomBytes(16).toString('hex');
};

/**
 * Resolves the frontend QR destination URL from environment variables.
 */
export const buildQrUrl = (token) => {
  const rawBase =
    process.env.QR_FRONTEND_URL ||
    (process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',')[0].trim() : '') ||
    'http://localhost:5173';
  const cleanBase = rawBase.replace(/\/+$/, '');
  // The customer app is served under a base path (vite `base`, '/Paperlessbackup/'),
  // the same one the payment return URLs use — without it the link 404s.
  const basePath = (process.env.FRONTEND_BASE_PATH ?? '/Paperlessbackup/').replace(/\/+$/, '');
  const appRoot = basePath && !cleanBase.endsWith(basePath) ? `${cleanBase}${basePath}` : cleanBase;
  const portalPath = (process.env.QR_PORTAL_PATH || '/new-connection').replace(/^\/?/, '/');
  return `${appRoot}${portalPath}?salesRef=${encodeURIComponent(token)}`;
};

/**
 * Checks if a given application object matches the completed sale criteria.
 */
export const isCompletedSale = (app) => {
  if (!app) return false;
  return Boolean(
    app.completedSale === true ||
    app.paymentStatus === 'paid' ||
    app.status === 'confirmed' ||
    app.status === 'completed'
  );
};

/**
 * Query criteria for completed sales in Mongoose.
 */
export const getCompletedSaleFilter = () => ({
  $or: [
    { completedSale: true },
    { paymentStatus: 'paid' },
    { status: { $in: ['confirmed', 'completed'] } },
  ],
});

/**
 * Normalizes and validates whether a user role represents a Sales Officer.
 */
export const isSalesOfficerRole = (role) => {
  if (!role || typeof role !== 'string') return false;
  return /^sales\s*officer$/i.test(role.trim());
};

/**
 * Finds a registered Sales Officer by employee number.
 */
export const findSalesOfficerByEmployeeNumber = async (employeeNumber) => {
  if (!employeeNumber) return null;
  const cleanEmployeeNumber = String(employeeNumber).trim();

  // Try exact match first
  let officer = await User.findOne({
    employeeNumber: cleanEmployeeNumber,
    role: { $regex: /^sales\s*officer$/i },
  });

  if (!officer) {
    // Case-insensitive match on employee number preserving strings with leading zeros
    officer = await User.findOne({
      employeeNumber: { $regex: new RegExp(`^${escapeRegex(cleanEmployeeNumber)}$`, 'i') },
      role: { $regex: /^sales\s*officer$/i },
    });
  }

  return officer;
};

/**
 * Retrieves an existing QR tracking record for an officer or creates a new one.
 * Prevents duplicate records for the same officer.
 */
export const getOrCreateOfficerQr = async (officer, { regenerate = false, metadata = {} } = {}) => {
  if (!officer) {
    throw new Error('Sales Officer user document is required');
  }

  if (!isSalesOfficerRole(officer.role)) {
    throw new Error(`User ${officer.employeeNumber || officer.name} is not a registered Sales Officer (role: ${officer.role})`);
  }

  let qrRecord = await SalesOfficerQr.findOne({
    $or: [{ officer: officer._id }, { employeeNumber: officer.employeeNumber }],
  });

  if (qrRecord) {
    if (regenerate) {
      // Archive current active token
      if (!qrRecord.previousTokens) qrRecord.previousTokens = [];
      qrRecord.previousTokens.push({
        token: qrRecord.trackingToken,
        invalidatedAt: new Date(),
      });

      const newToken = generateTrackingToken();
      qrRecord.trackingToken = newToken;
      qrRecord.qrUrl = buildQrUrl(newToken);
      qrRecord.isActive = true;
      qrRecord.regeneratedAt = new Date();
      if (metadata && Object.keys(metadata).length > 0) {
        qrRecord.metadata = { ...(qrRecord.metadata || {}), ...metadata };
      }
      await qrRecord.save();
    }
    return { qrRecord, created: false };
  }

  // Create new tracking record
  const token = generateTrackingToken();
  const qrUrl = buildQrUrl(token);

  qrRecord = await SalesOfficerQr.create({
    officer: officer._id,
    employeeNumber: officer.employeeNumber,
    trackingToken: token,
    qrUrl,
    isActive: true,
    metadata,
  });

  return { qrRecord, created: true };
};

/**
 * Computes live statistics for an officer from the database.
 */
export const getOfficerStatistics = async (officerId, employeeNumber, query = {}) => {
  const cleanOfficerId =
    officerId && mongoose.Types.ObjectId.isValid(officerId)
      ? new mongoose.Types.ObjectId(String(officerId))
      : officerId;
  const cleanEmpNumber = String(employeeNumber || '').trim();

  const match = {
    $or: [{ salesOfficer: cleanOfficerId }, { salesOfficerEmployeeNumber: cleanEmpNumber }],
  };

  // Date filtering
  const { startDate, endDate, from, to } = query;
  const start = startDate || from;
  const end = endDate || to;

  if (start || end) {
    match.createdAt = {};
    if (start) match.createdAt.$gte = new Date(start);
    if (end) match.createdAt.$lte = new Date(new Date(end).setHours(23, 59, 59, 999));
  }

  // 1. Total Attributed Applications
  const totalApplications = await Application.countDocuments(match);

  // 2. Status Breakdown
  const statusAggregation = await Application.aggregate([
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const byStatus = {
    pending: 0,
    'pending payment': 0,
    approved: 0,
    confirmed: 0,
    completed: 0,
    rejected: 0,
    flagged: 0,
  };

  statusAggregation.forEach((row) => {
    if (row._id) {
      byStatus[row._id] = row.count;
    }
  });

  // 3. Total Completed Sales (no double counting)
  const completedMatch = {
    $and: [
      match,
      getCompletedSaleFilter(),
    ],
  };
  const totalCompletedSales = await Application.countDocuments(completedMatch);

  // 4. Completion Rate
  const completionRate =
    totalApplications > 0
      ? Number(((totalCompletedSales / totalApplications) * 100).toFixed(2))
      : 0;

  // 5. Recent Activity Timeline
  const recent = await Application.find(match)
    .sort({ createdAt: -1 })
    .limit(10)
    .select('referenceNumber serviceType status paymentStatus createdAt completedSaleAt completedSale nic phone')
    .lean();

  const recentTimeline = recent.map((app) => ({
    referenceNumber: app.referenceNumber,
    serviceType: app.serviceType,
    status: app.status,
    paymentStatus: app.paymentStatus,
    submittedAt: app.createdAt,
    completedSaleAt: app.completedSaleAt || (isCompletedSale(app) ? app.createdAt : null),
    isCompletedSale: isCompletedSale(app),
  }));

  return {
    totalApplications,
    totalCompletedSales,
    completionRate,
    byStatus,
    completedSalesDefinition: COMPLETED_SALE_DEFINITION,
    dateRange: {
      from: start || null,
      to: end || null,
    },
    recentApplications: recentTimeline,
  };
};
