import fs from 'node:fs';
import path from 'node:path';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { pipeline } from 'node:stream/promises';
import { BackupError, redact } from './errors.js';

// -----------------------------------------------------------------------------
// OPTIONAL: include the customer-document storage bucket(s) (Supabase Storage
// through its S3-compatible API) in a "Database + uploaded files" backup.
//
// OFF BY DEFAULT. Turn on with BACKUP_INCLUDE_SUPABASE_STORAGE=true and, if the
// bucket differs from STORAGE_BUCKET, BACKUP_SUPABASE_BUCKETS=bucket1,bucket2.
// It reads the bucket with the same STORAGE_* credentials the portal uses.
//
// Objects are copied byte for byte (they are already envelope-encrypted by the
// portal) into the backup bundle, which is then encrypted again as a whole.
//
// A restore uploads the objects back. It NEVER deletes bucket files that are not
// in the backup, unless the admin explicitly asks for that.
// -----------------------------------------------------------------------------

const CONCURRENCY = 4;

export const documentBackupSettings = (env = process.env) => {
  const enabled = String(env.BACKUP_INCLUDE_SUPABASE_STORAGE || '').trim().toLowerCase() === 'true';
  const listed = String(env.BACKUP_SUPABASE_BUCKETS || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const buckets = listed.length ? listed : [env.STORAGE_BUCKET || env.S3_BUCKET || 'kyc-documents'];
  const configured = Boolean(
    (env.STORAGE_ACCESS_KEY || env.AWS_ACCESS_KEY_ID) && (env.STORAGE_SECRET_KEY || env.AWS_SECRET_ACCESS_KEY)
  );
  return { enabled, buckets, configured };
};

export function createDocumentClient(env = process.env) {
  const endpoint = env.STORAGE_ENDPOINT || env.S3_ENDPOINT;
  return new S3Client({
    region: env.STORAGE_REGION || env.AWS_REGION || 'ap-southeast-1',
    credentials: {
      accessKeyId: env.STORAGE_ACCESS_KEY || env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: env.STORAGE_SECRET_KEY || env.AWS_SECRET_ACCESS_KEY || '',
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    ...(endpoint ? { endpoint, forcePathStyle: env.STORAGE_FORCE_PATH_STYLE !== 'false' } : {}),
  });
}

/** Checks the settings and that every bucket can be reached, before a backup row is created. */
export async function assertDocumentBackupReady(client, settings = documentBackupSettings()) {
  if (!settings.configured) {
    throw new BackupError(
      'Including the document storage bucket is turned on, but the storage credentials (STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY) are not set.',
      503,
      'DOCUMENTS_NOT_CONFIGURED'
    );
  }
  for (const bucket of settings.buckets) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error) {
      console.error(`[backup] document bucket "${bucket}" check failed: ${redact(error?.message)}`);
      throw new BackupError(
        `The document storage bucket "${bucket}" cannot be reached. Check BACKUP_SUPABASE_BUCKETS and the STORAGE_* settings.`,
        503,
        'DOCUMENTS_UNREACHABLE'
      );
    }
  }
}

async function* listAll(client, bucket) {
  let token;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const item of page.Contents || []) {
      if (item.Key && !item.Key.endsWith('/')) yield item;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

/** Runs `worker` over `items` with a small, fixed concurrency. */
async function mapLimit(items, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

/**
 * Copies every object of the buckets into `destDir` (files named by index, so
 * odd key characters cannot cause trouble) and writes `index.json` describing them.
 * @returns {{ buckets: { bucket: string, count: number, bytes: number }[] }} a summary
 */
export async function downloadBuckets(client, buckets, destDir, { onProgress } = {}) {
  await fs.promises.mkdir(destDir, { recursive: true });
  const index = [];
  const summary = [];

  for (const bucket of buckets) {
    const objects = [];
    for await (const item of listAll(client, bucket)) objects.push({ key: item.Key, size: Number(item.Size) || 0 });
    const bucketIndex = index.length;
    const entries = objects.map((o, i) => ({ key: o.key, size: o.size, file: `${bucketIndex}-${i}.bin` }));
    let done = 0;
    await mapLimit(entries, async (entry) => {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: entry.key }));
      await pipeline(response.Body, fs.createWriteStream(path.join(destDir, entry.file), { mode: 0o600 }));
      entry.contentType = response.ContentType || 'application/octet-stream';
      entry.metadata = response.Metadata && Object.keys(response.Metadata).length ? response.Metadata : undefined;
      done += 1;
      onProgress?.({ bucket, done, total: entries.length });
    });
    index.push({ bucket, objects: entries });
    summary.push({ bucket, count: entries.length, bytes: entries.reduce((sum, e) => sum + e.size, 0) });
  }

  await fs.promises.writeFile(path.join(destDir, 'index.json'), JSON.stringify({ format: 1, buckets: index }, null, 2));
  return { buckets: summary };
}

/**
 * Uploads the objects of a backup back into their buckets (overwriting objects
 * with the same key). Extra objects in the bucket are left alone unless
 * `deleteExtra` is true.
 * @returns {{ uploaded: number, deleted: number }}
 */
export async function restoreBuckets(client, srcDir, { deleteExtra = false, onProgress } = {}) {
  const index = JSON.parse(await fs.promises.readFile(path.join(srcDir, 'index.json'), 'utf8'));
  let uploaded = 0;
  let deleted = 0;

  for (const { bucket, objects } of index.buckets) {
    await mapLimit(objects, async (entry) => {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: entry.key,
          Body: await fs.promises.readFile(path.join(srcDir, entry.file)),
          ContentLength: entry.size,
          ContentType: entry.contentType,
          ...(entry.metadata ? { Metadata: entry.metadata } : {}),
        })
      );
      uploaded += 1;
      onProgress?.({ bucket, done: uploaded });
    });

    if (deleteExtra) {
      const wanted = new Set(objects.map((o) => o.key));
      const extras = [];
      for await (const item of listAll(client, bucket)) if (!wanted.has(item.Key)) extras.push(item.Key);
      for (const key of extras) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        deleted += 1;
      }
    }
  }
  return { uploaded, deleted };
}
