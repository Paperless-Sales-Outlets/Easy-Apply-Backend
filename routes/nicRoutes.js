import express from 'express';
import multer from 'multer';
import { scanNIC } from '../controllers/nicController.js';

const router = express.Router();

// Memory storage to handle optional multipart file uploads (up to 10MB each)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const cpUpload = upload.fields([
  { name: 'nicFront', maxCount: 1 },
  { name: 'nicBack', maxCount: 1 },
]);

// POST /api/nic/scan
router.post('/scan', cpUpload, scanNIC);

export default router;
