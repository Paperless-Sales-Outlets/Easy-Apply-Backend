import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Ensure uploads/documents directory exists
const uploadDir = path.join(process.cwd(), 'uploads', 'documents');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

// File filter (PDF/JPG/JPEG/PNG validation)
const fileFilter = (req, file, cb) => {
  const allowedExtensions = /\.(pdf|jpg|jpeg|png)$/i;
  const allowedMimeTypes = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
  ];

  const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedMimeTypes.includes(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  }

  cb(new Error('Invalid file format. Only PDF, JPG, JPEG, and PNG files up to 5MB are allowed.'));
};

// Multer upload instance (5MB size limit per file)
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

// Multipart fields definitions for EasyApply document slots
export const uploadApplicationDocuments = upload.fields([
  { name: 'nicFront', maxCount: 1 },
  { name: 'nicBack', maxCount: 1 },
  { name: 'passportDoc', maxCount: 1 },
  { name: 'brcDoc', maxCount: 1 },
  { name: 'vatDoc', maxCount: 1 },
  { name: 'taxExemptionDoc', maxCount: 1 },
]);

// Wrapper middleware to gracefully handle Multer upload errors
export const handleFileUploads = (req, res, next) => {
  // If request is JSON (e.g. Base64 payload), skip Multer parsing
  if (req.is('application/json')) {
    return next();
  }

  uploadApplicationDocuments(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400);
        return next(new Error('File size exceeds the 5MB limit.'));
      }
      res.status(400);
      return next(new Error(`File upload error: ${err.message}`));
    } else if (err) {
      res.status(400);
      return next(new Error(err.message));
    }
    next();
  });
};
