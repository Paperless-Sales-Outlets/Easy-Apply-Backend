import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import connectDB from './config/db.js';
import applicationRoutes from './routes/applicationRoutes.js';
import adminApplicationRoutes from './routes/admin/applicationRoutes.js';
import otpRoutes from './routes/otpRoutes.js';
import authRoutes from './routes/authRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import { errorHandler } from './middleware/errorMiddleware.js';

// Load environmental variables
dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();

// Security Middlewares
app.use(helmet());
app.use(cors());

// Request Parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Development Logger
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Health Check Route
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'SLTMobitel EasyApply API is active',
    version: '1.0.0',
  });
});

// Map API Routes
app.use('/api/otp', otpRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/admin/applications', adminApplicationRoutes);
app.use('/api/payment', paymentRoutes);


// Global Error Handler Middleware
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(
    `Server running in ${process.env.NODE_ENV} mode on port ${PORT}`
  );
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Unhandled Rejection Error: ${err.message}`);
  // Close server & exit process
  server.close(() => process.exit(1));
});
