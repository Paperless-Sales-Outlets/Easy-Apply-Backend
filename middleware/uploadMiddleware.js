import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Ensure uploads directory exists for local disk storage
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Local disk storage engine configuration
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const safeFieldName = file.fieldname ? file.fieldname.replace(/[^a-zA-Z0-9_-]/g, '') : 'doc';
    cb(null, `${safeFieldName}-${uniqueSuffix}${ext}`);
  },
});

/*
 * FUTURE AWS S3 STORAGE CONFIGURATION (Once Vanuja completes S3 bucket setup):
 * 
 * import { S3Client } from '@aws-sdk/client-s3';
 * import multerS3 from 'multer-s3';
 * 
 * const s3 = new S3Client({
 *   region: process.env.AWS_REGION,
 *   credentials: {
 *     accessKeyId: process.env.AWS_ACCESS_KEY_ID,
 *     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
 *   },
 * });
 * 
 * const s3Storage = multerS3({
 *   s3: s3,
 *   bucket: process.env.AWS_S3_BUCKET_NAME,
 *   acl: 'private',
 *   metadata: (req, file, cb) => {
 *     cb(null, { fieldName: file.fieldname });
 *   },
 *   key: (req, file, cb) => {
 *     const ext = path.extname(file.originalname).toLowerCase();
 *     const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
 *     cb(null, `documents/${file.fieldname}-${uniqueSuffix}${ext}`);
 *   },
 * });
 */

// File filter for acceptable document types
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|pdf/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  }
  cb(new Error('Invalid document format. Only PDF, JPG, JPEG, and PNG files are allowed.'));
};

// Configured multer middleware instance (max 5MB file size limit per document)
export const uploadMiddleware = multer({
  storage: diskStorage, // Switch to s3Storage once AWS S3 is active
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: fileFilter,
});

export default uploadMiddleware;
