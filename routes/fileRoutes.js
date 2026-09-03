import express from 'express';
import { serveGridFsFile, deleteGridFsFile } from '../controllers/fileController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// All file-serving endpoints require a logged-in Admin or Staff member
// so that sensitive KYC documents (NICs, passports, signatures) are never
// publicly accessible.
router.use(protect, authorize('Admin', 'Staff'));

// Stream a file stored in GridFS
router.get('/:id', serveGridFsFile);

// Delete a file from GridFS (admin clean-up only)
router.delete('/:id', authorize('Admin'), deleteGridFsFile);

export default router;
