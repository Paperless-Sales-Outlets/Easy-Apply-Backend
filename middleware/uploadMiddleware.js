import multer from 'multer';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { GridFsStorage } from 'multer-gridfs-storage';
import dotenv from 'dotenv';
dotenv.config();

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

// ---------------------------------------------------------------------------
// GridFS storage — files are saved directly into MongoDB (fs.files / fs.chunks)
// ---------------------------------------------------------------------------
const gridFsStorage = new GridFsStorage({
  // Instead of trying to share the Mongoose connection and fighting version mismatches,
  // we let GridFS connect independently using its own built-in driver:
  url: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/paperlessoutlet',

  file: (req, file) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    return {
      bucketName: 'uploads',
      filename: `${file.fieldname}-${uniqueSuffix}${ext}`,
      metadata: {
        originalname: file.originalname,
        mimetype: file.mimetype,
        uploadedAt: new Date(),
      },
    };
  },
});


const gridFsUpload = multer({
  storage: gridFsStorage,
  fileFilter,
  limits: LIMITS,
});

// ---------------------------------------------------------------------------
// Disk storage fallback — used only when MongoDB is offline
// Files are written to uploads/documents/ on the local filesystem.
// NOTE: this folder is in .gitignore — files here are NEVER committed to git.
// ---------------------------------------------------------------------------
const uploadDir = path.join(process.cwd(), 'uploads', 'documents');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

const diskUpload = multer({
  storage: diskStorage,
  fileFilter,
  limits: LIMITS,
});

// ---------------------------------------------------------------------------
// handleFileUploads — picks GridFS when DB is connected, disk otherwise.
// This is the middleware exported and used in routes.
// ---------------------------------------------------------------------------
export const handleFileUploads = (req, res, next) => {
  // JSON payloads (e.g. Base64 signature) skip Multer entirely
  if (req.is('application/json')) return next();

  const dbConnected = mongoose.connection.readyState === 1;
  const uploader = dbConnected ? gridFsUpload : diskUpload;

  uploader.any()(req, res, (err) => {
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

    // Tag each file so the controller knows where it lives
    if (req.files) {
      req.files = req.files.map((f) => ({
        ...f,
        storageBackend: dbConnected ? 'gridfs' : 'disk',
      }));
    }

    next();
  });
};

// Legacy named export kept for any existing imports
export const uploadApplicationDocuments = handleFileUploads;
