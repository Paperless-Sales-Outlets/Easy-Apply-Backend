import multer from 'multer';
import path from 'path';
import { uploadBuffer, isStorageConfigured } from '../services/storageService.js';

// ---------------------------------------------------------------------------
// Shared file filter — accepts PDF / JPG / JPEG / PNG up to 5 MB
// ---------------------------------------------------------------------------
const fileFilter = (req, file, cb) => {
  const allowedExtensions = /\.(pdf|jpg|jpeg|png)$/i;
  const allowedMimeTypes = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
  ];

  const extOk = allowedExtensions.test(
    path.extname(file.originalname).toLowerCase()
  );
  const mimeOk = allowedMimeTypes.includes(file.mimetype);

  if (extOk && mimeOk) return cb(null, true);

  cb(
    new Error(
      'Invalid file format. Only PDF, JPG, JPEG, and PNG files up to 5MB are allowed.'
    )
  );
};

const LIMITS = { fileSize: 5 * 1024 * 1024 }; // 5 MB per file

// Use memory storage so file buffers are uploaded directly to centralized object storage
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: LIMITS,
});

// ---------------------------------------------------------------------------
// handleFileUploads — intercepts multipart files in memory and uploads them
// to centralized S3/Supabase Storage, attaching storage URLs to req.files.
// ---------------------------------------------------------------------------
export const handleFileUploads = (req, res, next) => {
  // JSON payloads (e.g. Base64 signature) skip Multer entirely
  if (req.is('application/json')) return next();

  memoryUpload.any()(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      console.error('Multer Error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400);
        return next(new Error('File size exceeds the 5MB limit.'));
      }
      res.status(400);
      return next(
        new Error(`File upload error: ${err.message} (Field: ${err.field})`)
      );
    } else if (err) {
      res.status(400);
      return next(new Error(err.message));
    }

    // If storage is configured and files were uploaded, upload them to cloud bucket
    if (req.files && req.files.length > 0 && isStorageConfigured()) {
      try {
        await Promise.all(
          req.files.map(async (f) => {
            if (f.buffer) {
              const uploaded = await uploadBuffer({
                buffer: f.buffer,
                originalname: f.originalname,
                mimetype: f.mimetype,
                folder: 'documents',
              });
              f.url = uploaded.url;
              f.key = uploaded.key;
              f.storageBackend = 's3';
            }
          })
        );
      } catch (uploadErr) {
        console.error('Centralized storage upload error:', uploadErr.message);
      }
    }

    next();
  });
};

export default handleFileUploads;
