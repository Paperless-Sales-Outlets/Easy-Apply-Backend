import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';

import connectDB from './config/db.js';

import applicationRoutes from './routes/applicationRoutes.js';
import adminApplicationRoutes from './routes/admin/applicationRoutes.js';
import otpRoutes from './routes/otpRoutes.js';
import authRoutes from './routes/authRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import productRoutes from './routes/productRoutes.js';
import cartRoutes from './routes/cartRoutes.js';
import customerRoutes from './routes/customerRoutes.js';

import { errorHandler } from './middleware/errorMiddleware.js';
import { requestLogger, errorLogger } from './middleware/loggingMiddleware.js';
import { notFound } from './middleware/errorHandler.js';
import { protect, authorize } from './middleware/authMiddleware.js';


// Load environmental variables
dotenv.config();


// Connect Database
connectDB();


const app = express();


// Security Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: 'cross-origin',
    },
  })
);


app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin === process.env.FRONTEND_URL) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  optionsSuccessStatus: 204
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



// Upload Directory
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


app.use(
  '/uploads',
  express.static(uploadsPath)
);



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

const PORT =
  process.env.PORT || 5000;


const server = app.listen(
  PORT,
  () => {

    console.log(
      `Server running in ${process.env.NODE_ENV} mode on port ${PORT}`
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