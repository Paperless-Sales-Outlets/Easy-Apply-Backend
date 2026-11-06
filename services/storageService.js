import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';
import path from 'node:path';
import 'dotenv/config';
import {
  encryptBuffer,
  decryptBuffer,
  isEncryptedBuffer,
} from './encryptionService.js';

let s3Client = null;

const getBucket = () => process.env.STORAGE_BUCKET || process.env.S3_BUCKET || 'kyc-documents';
const getRegion = () => process.env.STORAGE_REGION || process.env.AWS_REGION || 'ap-southeast-1';

/**
 * Extracts Supabase project reference if endpoint is a Supabase S3 endpoint
 * e.g. https://yawxtplhzqqtpxmhlftp.storage.supabase.co/storage/v1/s3 => yawxtplhzqqtpxmhlftp
 */
export const getSupabaseRef = () => {
  const endpoint = process.env.STORAGE_ENDPOINT || process.env.S3_ENDPOINT || '';
  const match = endpoint.match(/https?:\/\/([a-z0-9_-]+)\.storage\.supabase\.co/i);
  return match ? match[1] : null;
};

export const isStorageConfigured = () => {
  const hasS3 = Boolean(
    (process.env.STORAGE_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID) &&
    (process.env.STORAGE_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY)
  );
  const hasSupabase = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY
  );
  return hasS3 || hasSupabase;
};

export const getStorageClient = () => {
  if (!s3Client) {
    const endpoint = process.env.STORAGE_ENDPOINT || process.env.S3_ENDPOINT;
    const accessKeyId = process.env.STORAGE_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.STORAGE_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;
    const region = getRegion();

    const config = {
      region,
      credentials: {
        accessKeyId: accessKeyId || '',
        secretAccessKey: secretAccessKey || '',
      },
    };

    if (endpoint) {
      config.endpoint = endpoint;
      config.forcePathStyle = process.env.STORAGE_FORCE_PATH_STYLE !== 'false';
    }

    s3Client = new S3Client(config);
  }
  return s3Client;
};

/**
 * Uploads a file buffer directly to Supabase Storage via REST API
 */
async function uploadViaSupabaseRest({ buffer, key, mimetype, bucket }) {
  const ref = getSupabaseRef();
  const supabaseUrl = process.env.SUPABASE_URL || (ref ? `https://${ref}.supabase.co` : null);
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Supabase Storage authentication missing: Please provide STORAGE_ACCESS_KEY in .env, or provide SUPABASE_SERVICE_ROLE_KEY / SUPABASE_KEY.'
    );
  }

  const uploadEndpoint = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${bucket}/${key}`;
  const response = await fetch(uploadEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': mimetype || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: buffer,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Supabase Storage REST upload failed (${response.status}): ${errText}`);
  }

  const publicUrl = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/${key}`;
  return { key, url: publicUrl };
}

/**
 * Formats a clean public or pre-signed URL for a stored key
 */
export function formatPublicStorageUrl(key) {
  const bucket = getBucket();
  const rawPublicUrl = process.env.STORAGE_PUBLIC_URL || '';

  if (rawPublicUrl.includes('.storage.supabase.co/storage/v1/s3')) {
    const ref = getSupabaseRef();
    if (ref) {
      return `https://${ref}.supabase.co/storage/v1/object/public/${bucket}/${key}`;
    }
  }

  if (rawPublicUrl && !rawPublicUrl.endsWith('/s3')) {
    const base = rawPublicUrl.replace(/\/+$/, '');
    return `${base}/${key}`;
  }

  const ref = getSupabaseRef();
  if (ref) {
    return `https://${ref}.supabase.co/storage/v1/object/public/${bucket}/${key}`;
  }

  return null;
}

/**
 * Uploads a file buffer directly to Supabase Storage bucket.
 * Encrypts sensitive documents with AES-256-GCM before storage by default.
 * Strictly uploads to Supabase (no local disk storage).
 * Returns the stored key and displayable URL.
 */
export async function uploadBuffer({
  buffer,
  originalname = 'file',
  mimetype = 'application/octet-stream',
  folder = 'documents',
  encrypt = true,
}) {
  const ext = path.extname(originalname).toLowerCase() || '.png';
  const cleanFolder = folder.replace(/^\/+|\/+$/g, '');
  const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const key = cleanFolder ? `${cleanFolder}/${uniqueName}` : uniqueName;

  const bucket = getBucket();
  const accessKeyId = process.env.STORAGE_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.STORAGE_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

  // 1. Encrypt buffer at rest if requested
  const payloadBuffer = encrypt ? encryptBuffer(buffer) : buffer;

  // 2. If S3 Access Key ID and Secret are available, use S3 Client
  if (accessKeyId && secretKey) {
    try {
      const client = getStorageClient();
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: payloadBuffer,
          ContentType: mimetype,
          Metadata: {
            'x-encrypted': encrypt ? 'true' : 'false',
          },
        })
      );

      const publicUrl = formatPublicStorageUrl(key);
      if (publicUrl) {
        return { key, url: publicUrl, encrypted: encrypt };
      }

      const presignedUrl = await getSignedFileUrl(key);
      return { key, url: presignedUrl, encrypted: encrypt };
    } catch (s3Err) {
      console.warn(`[Supabase Storage S3] Upload failed: ${s3Err.message}`);
      if (supabaseKey) {
        console.log('[Supabase Storage] Retrying upload via Supabase Storage REST API...');
        return await uploadViaSupabaseRest({ buffer: payloadBuffer, key, mimetype, bucket });
      }
      throw s3Err;
    }
  }

  // 3. If Supabase REST key is available, upload directly via Supabase REST API
  if (supabaseKey) {
    return await uploadViaSupabaseRest({ buffer: payloadBuffer, key, mimetype, bucket });
  }

  throw new Error(
    'Supabase Storage is not configured. Missing STORAGE_ACCESS_KEY in .env. Please see the Supabase S3 guide to obtain your Access Key ID.'
  );
}

/**
 * Resolves a raw key or public/signed URL to its relative storage key.
 */
export function extractStorageKey(keyOrUrl) {
  if (!keyOrUrl || typeof keyOrUrl !== 'string') return '';
  let clean = keyOrUrl.trim();

  // If URL: extract after bucket name
  const bucket = getBucket();
  const bucketMarker = `/${bucket}/`;
  if (clean.includes(bucketMarker)) {
    clean = clean.split(bucketMarker).pop();
  }

  // Remove leading query params or slashes
  clean = clean.split(/[?#]/)[0].replace(/^\/+/, '');
  if (clean.startsWith('public/')) clean = clean.slice(7);
  if (clean.startsWith('authenticated/')) clean = clean.slice(14);
  return clean;
}

/**
 * Downloads a file from Supabase Storage and decrypts it on the fly if encrypted.
 * Returns { buffer, isEncrypted, key }.
 */
export async function downloadBuffer(keyOrUrl) {
  const cleanKey = extractStorageKey(keyOrUrl);
  if (!cleanKey) {
    throw new Error('Invalid storage key or URL provided for download.');
  }

  const bucket = getBucket();
  const accessKeyId = process.env.STORAGE_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.STORAGE_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  let rawBuffer = null;

  // 1. Try S3 client download
  if (accessKeyId && secretKey) {
    try {
      const client = getStorageClient();
      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: cleanKey,
        })
      );

      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      rawBuffer = Buffer.concat(chunks);
    } catch (s3Err) {
      console.warn(`[Supabase Storage S3] Download for key "${cleanKey}" failed: ${s3Err.message}`);
    }
  }

  // 2. Fallback: try direct HTTP fetch from Supabase public / authenticated URL
  if (!rawBuffer) {
    const ref = getSupabaseRef();
    const publicUrl = formatPublicStorageUrl(cleanKey) || (ref ? `https://${ref}.supabase.co/storage/v1/object/public/${bucket}/${cleanKey}` : null);
    if (publicUrl) {
      const res = await fetch(publicUrl);
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        rawBuffer = Buffer.from(arrayBuf);
      }
    }
  }

  if (!rawBuffer) {
    throw new Error(`Failed to download object "${cleanKey}" from Supabase Storage.`);
  }

  const encrypted = isEncryptedBuffer(rawBuffer);
  const decryptedBuffer = decryptBuffer(rawBuffer);

  return {
    buffer: decryptedBuffer,
    isEncrypted: encrypted,
    key: cleanKey,
  };
}

/**
 * Generates a pre-signed URL for a stored key or returns standard URL if already absolute.
 */
export async function getSignedFileUrl(keyOrUrl, expiresInSec = 3600) {
  if (!keyOrUrl) return '';
  if (/^https?:\/\//.test(keyOrUrl) && !keyOrUrl.includes('X-Amz-Signature')) {
    return keyOrUrl;
  }

  const accessKeyId = process.env.STORAGE_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.STORAGE_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;

  if (accessKeyId && secretKey) {
    const client = getStorageClient();
    const bucket = getBucket();
    const cleanKey = extractStorageKey(keyOrUrl);

    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: cleanKey,
      });
      return await getSignedUrl(client, command, { expiresIn: expiresInSec });
    } catch (error) {
      console.warn(`Storage presign failed for key "${cleanKey}": ${error.message}`);
    }
  }

  const publicUrl = formatPublicStorageUrl(keyOrUrl);
  return publicUrl || keyOrUrl;
}

/**
 * Deletes a file from the storage bucket.
 */
export async function deleteFile(key) {
  if (!key) return;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.STORAGE_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;

  if (accessKeyId && secretKey) {
    const client = getStorageClient();
    const bucket = getBucket();
    const cleanKey = extractStorageKey(key);
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: cleanKey,
        })
      );
    } catch (err) {
      console.warn(`Failed to delete storage object "${cleanKey}":`, err.message);
    }
  }
}

export default {
  uploadBuffer,
  downloadBuffer,
  getSignedFileUrl,
  deleteFile,
  isStorageConfigured,
  formatPublicStorageUrl,
  extractStorageKey,
};
