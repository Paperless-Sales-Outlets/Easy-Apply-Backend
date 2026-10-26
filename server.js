
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';

import connectDB, { isDbConnected } from './config/db.js';
import { startKycAutoReviewScheduler } from './services/kycAutoReviewService.js';
import { startDraftExpiryScheduler } from './services/draftExpiryService.js';

import applicationRoutes from './routes/applicationRoutes.js';
import adminApplicationRoutes from './routes/admin/applicationRoutes.js';
import adminFormsRoutes from './routes/admin/formsRoutes.js';
import adminKycRoutes from './routes/admin/kycRoutes.js';
import adminAnalyticsRoutes from './routes/admin/analyticsRoutes.js';
import adminAppointmentRoutes from './routes/admin/appointmentRoutes.js';
import adminUsersRoutes from './routes/admin/usersRoutes.js';
import adminRolesRoutes from './routes/admin/rolesRoutes.js';
import adminPrivilegesRoutes from './routes/admin/privilegesRoutes.js';
import adminAuditRoutes from './routes/admin/auditRoutes.js';
import adminDashboardStatsRoutes from './routes/admin/dashboardStatsRoutes.js';
import adminSalesOfficerRoutes from './routes/admin/salesOfficerRoutes.js';
import salesTrackingRoutes from './routes/salesTrackingRoutes.js';
import salesOfficerMeRoutes from './routes/salesOfficerMeRoutes.js';
import adminLeadRoutes from './routes/admin/leadRoutes.js';
import fieldAppointmentRoutes from './routes/field/fieldAppointmentRoutes.js';
import appointmentRoutes from './routes/appointmentRoutes.js';
import otpRoutes from './routes/otpRoutes.js';
import authRoutes from './routes/authRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import productRoutes from './routes/productRoutes.js';
import cartRoutes from './routes/cartRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import fileRoutes from './routes/fileRoutes.js';

// New Connection Draft routes
import draftRoutes from './routes/draftRoutes.js';

// SLT Banner routes
import sltBannerRoutes from './routes/sltBannerRoutes.js';

import { errorHandler, notFound } from './middleware/errorHandler.js';
import { requestLogger, errorLogger } from './middleware/loggingMiddleware.js';

// Connect Database
connectDB();

// Automated KYC review (set KYC_AUTO_REVIEW=off to disable)
startKycAutoReviewScheduler();

// Unfinished New Connection applications: hide them from the customer
// after 30 days (kept in the database, marked expired). Checked hourly.
startDraftExpiryScheduler();

// Drop legacy orderId index once connected
mongoose.connection.once('open', async () => {
  try {
    const indexes = await mongoose.connection
      .collection('appointments')
      .indexes();

    if (indexes.find((i) => i.name === 'orderId_1')) {
      await mongoose.connection
        .collection('appointments')
        .dropIndex('orderId_1');

      console.log(
        '✅ Dropped legacy orderId_1 index from appointments'
      );
    }
  } catch {
    // Index or collection may not exist yet
  }
});

const app = express();

// Security Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: 'cross-origin',
    },
  })
);

// Build an allowlist from FRONTEND_URL plus local dev origins.
// FRONTEND_URL may contain multiple comma-separated values.
const rawAllowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

// Always permit localhost Vite dev servers in non-production
if (process.env.NODE_ENV !== 'production') {
  [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
  ].forEach((devOrigin) => {
    if (!rawAllowedOrigins.includes(devOrigin)) {
      rawAllowedOrigins.push(devOrigin);
    }
  });
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests and explicitly allowed origins
      if (!origin || rawAllowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(
          new Error(`CORS: origin '${origin}' is not allowed`)
        );
      }
    },
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-session-id',
      'x-draft-token',
    ],
    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],
    optionsSuccessStatus: 204,
  })
);

// Request Parsing
app.use(
  express.json({
    limit: '20mb',
  })
);

app.use(
  express.urlencoded({
    limit: '20mb',
    extended: true,
  })
);

// Upload Directory — only used as a LOCAL FALLBACK when MongoDB is offline.
// Files are normally stored in MongoDB GridFS and served via the protected
// /api/files/:id endpoint.
//
// This folder is intentionally in .gitignore.
const uploadsPath = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, {
    recursive: true,
  });
}

// NOTE: We deliberately do NOT serve /uploads as a public static directory.
// Sensitive KYC documents must only be accessed by authenticated Admin/Staff
// via GET /api/files/:id which enforces authorization before streaming.

// Logging Middleware
app.use(requestLogger);

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Root Health Check
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'SLTMobitel EasyApply API is active',
    version: '1.0.0',
  });
});

// API Health Check
app.get('/api/health', (req, res) => {
  const dbStates = [
    'disconnected',
    'connected',
    'connecting',
    'disconnecting',
  ];

  res.status(200).json({
    success: true,
    dbConnected: isDbConnected(),
    dbState:
      dbStates[mongoose.connection.readyState] || 'unknown',
    dbHost: isDbConnected()
      ? mongoose.connection.host
      : null,
    environment: process.env.NODE_ENV,
  });
});

// =====================================
// API Routes
// =====================================

// SLT Banner Routes
app.use('/api/slt-banners', sltBannerRoutes);

// OTP Routes
app.use('/api/otp', otpRoutes);

// Authentication Routes
app.use('/api/auth', authRoutes);

// Application Routes
app.use('/api/applications', applicationRoutes);

// Admin Application Routes
app.use(
  '/api/admin/applications',
  adminApplicationRoutes
);

// Admin Forms Routes
app.use('/api/admin/forms', adminFormsRoutes);

// Admin KYC Routes
app.use('/api/admin/kyc', adminKycRoutes);

// Admin Analytics Routes
app.use(
  '/api/admin/analytics',
  adminAnalyticsRoutes
);

// Admin Appointment Routes
app.use(
  '/api/admin/appointments',
  adminAppointmentRoutes
);

// Admin User Management
app.use('/api/admin/users', adminUsersRoutes);

// Admin Role Management
app.use('/api/admin/roles', adminRolesRoutes);

// Admin Privilege Management
app.use(
  '/api/admin/privileges',
  adminPrivilegesRoutes
);

// Admin Audit Logs
app.use('/api/admin/audit-logs', adminAuditRoutes);

// Admin Dashboard / Forms summary figures (optional ?startDate=&endDate=)
app.use('/api/admin/dashboard-stats', adminDashboardStatsRoutes);

// Admin Sales Officers Management (supports /api/v1 and /api)
app.use('/api/v1/admin/sales-officers', adminSalesOfficerRoutes);
app.use('/api/admin/sales-officers', adminSalesOfficerRoutes);

// Public Sales Tracking (supports /api/v1 and /api)
app.use('/api/v1/sales-tracking', salesTrackingRoutes);
app.use('/api/sales-tracking', salesTrackingRoutes);

// Sales Officer Self-Service (supports /api/v1 and /api)
app.use('/api/v1/sales-officer', salesOfficerMeRoutes);
app.use('/api/sales-officer', salesOfficerMeRoutes);

// Admin Lead Management
app.use(
  '/api/admin/leads',
  adminLeadRoutes
);

// Field Appointment Routes
app.use(
  '/api/field/appointments',
  fieldAppointmentRoutes
);

// Customer Appointment Routes
app.use('/api/appointments', appointmentRoutes);

// Payment Routes
app.use('/api/payment', paymentRoutes);

// Product Routes
app.use('/api/products', productRoutes);

// Cart Routes
app.use('/api/cart', cartRoutes);

// Customer Routes
app.use('/api/customers', customerRoutes);

// Protected file-serving — streams KYC documents stored in MongoDB GridFS.
// Requires Admin or Staff JWT authentication.
app.use('/api/files', fileRoutes);

// Saved progress on New Connection applications
app.use('/api/drafts', draftRoutes);

// =====================================
// Error Handling
// =====================================

// Handle OPTIONS requests before 404 handler.
// CORS middleware above already handles valid preflight requests.
// No additional wildcard OPTIONS route is required.

// 404 Handler
app.use(notFound);

// Error Logging
app.use(errorLogger);

// Global Error Handler
app.use(errorHandler);

// =====================================
// Server Start
// =====================================

// Port 5050 avoids potential macOS port 5000 conflicts.
const PORT = process.env.PORT || 5050;

const server = app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `Server running in ${
        process.env.NODE_ENV || 'development'
      } mode on port ${PORT}`
    );
  }
);

// Handle Unhandled Promise Rejections
process.on('unhandledRejection', (err) => {
  console.log(
    `Unhandled Rejection Error: ${err.message}`
  );

  server.close(() => process.exit(1));
});

export { app, server };
export default app;
