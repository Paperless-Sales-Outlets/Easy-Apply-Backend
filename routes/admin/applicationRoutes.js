import express from 'express';
import { getAdminApplications } from '../../controllers/admin/applicationController.js';

const router = express.Router();

// Get paginated, filterable application list (Admin/Staff only)
router.get('/', getAdminApplications);

export default router;
