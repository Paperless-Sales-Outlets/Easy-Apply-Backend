import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let s3Client = null;

const isS3Configured = () =>
  Boolean(
    process.env.S3_BUCKET &&
    process.env.AWS_REGION &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
  );

const getS3Client = () => {
  if (!s3Client) {
    s3Client = new S3Client({ region: process.env.AWS_REGION });
  }
  return s3Client;
};

// Convert a stored public path like '/uploads/documents/abc.png' into an S3
// object key: '<S3_FOLDER>/abc.png' (default folder: 'documents').
const publicPathToKey = (publicPath) => {
  const match = String(publicPath).match(/\/uploads\/(?:documents\/)?([^?#]+)/);
  if (!match) return null;
  const file = match[1];
  const folder = (process.env.S3_FOLDER || 'documents').replace(/^\/+|\/+$/g, '');
  return folder ? `${folder}/${file}` : file;
};

// Resolve a stored document path to a displayable URL.
// - Absolute URLs are returned unchanged.
// - When S3 is configured, a fresh pre-signed URL is generated for the object.
// - Otherwise the local /uploads path is returned (local fallback).
export const getSignedFileUrl = async (publicPath, expiresInSec = 900) => {
  if (!publicPath) return '';
  if (/^https?:\/\//.test(publicPath)) return publicPath;

  if (!isS3Configured()) return publicPath;

  const key = publicPathToKey(publicPath);
  if (!key) return publicPath;

  try {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
    });
    return await getSignedUrl(getS3Client(), command, { expiresIn: expiresInSec });
  } catch (error) {
    console.warn(`S3 presign failed for ${key}: ${error.message}`);
    return publicPath;
  }
};

export default { getSignedFileUrl, isS3Configured };
