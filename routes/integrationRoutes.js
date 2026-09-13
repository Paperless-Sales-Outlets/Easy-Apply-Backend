import express from 'express';
import { requestOtp, verifyOtp } from '../controllers/consenthubAuthController.js';
import { integrationAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(integrationAuth);

router.post('/consenthub/auth/request-otp', requestOtp);
router.post('/consenthub/auth/verify-otp', verifyOtp);

export default router;
