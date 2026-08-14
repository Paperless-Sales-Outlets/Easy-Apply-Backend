import express from 'express';
import { getOperationDashboard } from '../../controllers/admin/dashboardController.js';
import { protect, authorize } from '../../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect, authorize('admin', 'staff'));

router.get('/', getOperationDashboard);

export default router;
