import express from 'express';
import { getAdminApplications } from '../../controllers/admin/applicationController.js';
import { protect, authorize } from '../../middleware/authMiddleware.js';

const router = express.Router();

// Get paginated, filterable application list (Admin/Staff only)
router.get('/', protect, authorize('Staff', 'Admin'), getAdminApplications);

export default router;
