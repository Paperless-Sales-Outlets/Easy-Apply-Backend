import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';

import connectDB, { isDbConnected } from './config/db.js';
import mongoose from 'mongoose';

import applicationRoutes from './routes/applicationRoutes.js';
import adminApplicationRoutes from './routes/admin/applicationRoutes.js';
import adminFormsRoutes from './routes/admin/formsRoutes.js';
import adminDashboardRoutes from './routes/admin/dashboardRoutes.js';
import adminDashboardStatsRoutes from './routes/admin/dashboardStatsRoutes.js';
import adminKycRoutes from './routes/admin/kycRoutes.js';
import adminAnalyticsRoutes from './routes/admin/analyticsRoutes.js';
import adminAppointmentRoutes from './routes/admin/appointmentRoutes.js';
import fieldAppointmentRoutes from './routes/field/fieldAppointmentRoutes.js';
import otpRoutes from './routes/otpRoutes.js';
import authRoutes from './routes/authRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import productRoutes from './routes/productRoutes.js';
import cartRoutes from './routes/cartRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import fileRoutes from './routes/fileRoutes.js';

import { errorHandler, notFound } from './middleware/errorHandler.js';
import { requestLogger, errorLogger } from './middleware/loggingMiddleware.js';
import { protect, authorize } from './middleware/authMiddleware.js';


// Load environmental variables
dotenv.config();


// Connect Database
connectDB();

// Drop legacy orderId index once connected
mongoose.connection.once('open', async () => {
  try {
    const indexes = await mongoose.connection.collection('appointments').indexes();
    if (indexes.find(i => i.name === 'orderId_1')) {
      await mongoose.connection.collection('appointments').dropIndex('orderId_1');
      console.log('✅ Dropped legacy orderId_1 index from appointments');
    }
  } catch (e) { /* index may not exist or collection may not exist yet */ }
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


// Build an allowlist from FRONTEND_URL plus any local dev origins.
// FRONTEND_URL may contain multiple comma-separated values for flexibility.
const rawAllowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

// Always permit localhost Vite dev server in non-production environments
if (process.env.NODE_ENV !== 'production') {
  ['http://localhost:5173', 'http://localhost:3000'].forEach((devOrigin) => {
    if (!rawAllowedOrigins.includes(devOrigin)) {
      rawAllowedOrigins.push(devOrigin);
    }
  });
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (curl, Postman, server-to-server) and
    // any origin that is explicitly listed in the allowlist.
    if (!origin || rawAllowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin '${origin}' is not allowed`));
    }
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  optionsSuccessStatus: 204,
}));



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
// /api/files/:id endpoint (see routes/fileRoutes.js).
// This folder is intentionally in .gitignore — its contents are NEVER committed.
const uploadsPath = path.join(
  process.cwd(),
  'uploads'
);


if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(
    uploadsPath,
    {
      recursive: true,
    }
  );
}


// NOTE: We deliberately do NOT serve /uploads as a public static directory.
// Sensitive KYC documents must only be accessed by authenticated Admin/Staff
// via GET /api/files/:id which enforces authorization before streaming.




// Logging Middleware
app.use(requestLogger);


if (process.env.NODE_ENV === 'development') {
  app.use(
    morgan('dev')
  );
}



// Health Check
app.get('/', (req, res) => {

  res.status(200).json({

    success: true,
    message: 'SLTMobitel EasyApply API is active',
    version: '1.0.0',

  });

});



// API Routes

app.get('/api/health', (req, res) => {
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];

  res.status(200).json({
    success: true,
    dbConnected: isDbConnected(),
    dbState: dbStates[mongoose.connection.readyState] || 'unknown',
    dbHost: isDbConnected() ? mongoose.connection.host : null,
    environment: process.env.NODE_ENV,
  });
});

app.use(
  '/api/otp',
  otpRoutes
);


app.use(
  '/api/auth',
  authRoutes
);


app.use(
  '/api/applications',
  applicationRoutes
);


app.use(
  '/api/admin/applications',
  protect,
  authorize('Admin', 'Staff'),
  adminApplicationRoutes
);

app.use(
  '/api/admin/forms',
  adminFormsRoutes
);

app.use(
  '/api/admin/dashboard',
  adminDashboardRoutes
);

app.use(
  '/api/admin/dashboard-stats',
  adminDashboardStatsRoutes
);


app.use(
  '/api/admin/kyc',
  adminKycRoutes
);

app.use(
  '/api/admin/analytics',
  adminAnalyticsRoutes
);

app.use(
  '/api/admin/appointments',
  adminAppointmentRoutes
);

app.use(
  '/api/field/appointments',
  fieldAppointmentRoutes
);


app.use(
  '/api/payment',
  paymentRoutes
);


// Payment Gateway Routes
app.use(
  '/api/products',
  productRoutes
);


app.use(
  '/api/cart',
  cartRoutes
);


app.use(
  '/api/customers',
  customerRoutes
);


// Protected file-serving — streams KYC documents stored in MongoDB GridFS.
// Requires Admin or Staff JWT authentication.
app.use(
  '/api/files',
  fileRoutes
);



// Handle OPTIONS requests before 404 handler
app.options('*', (req, res) => {
  res.status(204).end();
});

// 404 Handler
app.use(notFound);



// Error Logging
app.use(errorLogger);



// Global Error Handler
app.use(errorHandler);




// Server Start

// 5000 is commonly taken by macOS Control Center/AirPlay Receiver — 5050
// avoids that clash and matches the frontend's default VITE_API_BASE_URL.
const PORT =
  process.env.PORT || 5050;


const server = app.listen(
  PORT,
  () => {

    console.log(
      `Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`
    );

  }
);




// Handle Unhandled Promise Rejections

process.on(
  'unhandledRejection',
  (err) => {

    console.log(
      `Unhandled Rejection Error: ${err.message}`
    );


    server.close(
      () => process.exit(1)
    );

  }
);