import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { StorageAdapter, assertSafeKey } from './StorageAdapter.js';
import { BackupError, redact } from '../errors.js';

/**
 * Backups in S3-compatible object storage (AWS S3, MinIO, ...). Uses its own
 * BACKUP_S3_* credentials, separate from the customer-document bucket.
 *
 * Small files go up with one PutObject. Larger files use a multipart upload
 * (one part at a time, so memory stays at one part), which lifts S3's 5 GB
 * single-request limit: parts are at least 16 MiB and grow so that even a very
 * large file stays under S3's 10,000-part maximum. A failed upload is aborted so
 * no orphaned parts are left (and billed) in the bucket.
 */
const MIB = 1024 * 1024;
export const MULTIPART_THRESHOLD = 64 * MIB;
const MIN_PART = 5 * MIB; // S3 minimum for every part except the last
const MAX_PARTS = 10000;
const PART_RETRIES = 3;

/** Part size for a file: the configured size, grown so the part count stays under S3's limit. */
export const plannedPartSize = (size, configured = 16 * MIB) =>
  Math.max(configured, Math.ceil(size / (MAX_PARTS - 1) / MIB) * MIB);

export class S3StorageAdapter extends StorageAdapter {
  constructor({ endpoint, bucket, region, accessKeyId, secretAccessKey, prefix = 'backups', forcePathStyle = true, client, multipartThreshold = MULTIPART_THRESHOLD, partSize = 16 * MIB }) {
    super();
    this.multipartThreshold = multipartThreshold;
    this.partSize = Math.max(MIN_PART, partSize);
    this.bucket = bucket;
    this.prefix = prefix;
    this.endpoint = endpoint;
    this.client =
      client ||
      new S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
        // Newer SDK versions add checksum headers by default that many S3-compatible servers do not support.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        ...(endpoint ? { endpoint, forcePathStyle } : {}),
      });
  }

  get name() {
    return 's3';
  }

  describe() {
    let host = 'AWS S3';
    try {
      if (this.endpoint) host = new URL(this.endpoint).host;
    } catch {
      host = '(invalid endpoint)';
    }
    return `${host} / ${this.bucket} / ${this.prefix}`;
  }

  objectKey(key) {
    return `${this.prefix}/${assertSafeKey(key)}`;
  }

  async ensureReady() {
    if (!this.bucket) {
      throw new BackupError('S3 backup storage is not configured. Set BACKUP_S3_BUCKET.', 503, 'STORAGE_NOT_READY');
    }
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      console.error('[backup] S3 bucket check failed:', redact(error.message));
      throw new BackupError(
        'The backup bucket cannot be reached. Check the BACKUP_S3_* settings and credentials.',
        503,
        'STORAGE_NOT_READY'
      );
    }
  }

  async put(localPath, key) {
    const { size } = await fs.promises.stat(localPath);
    const objectKey = this.objectKey(key);
    if (size <= this.multipartThreshold) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          // A Buffer, not a stream: the SDK sends streams with a chunked checksum trailer and no
          // Content-Length, which MinIO and other S3-compatible servers reject (MissingContentLength).
          // Files above the multipart threshold never reach this branch, so memory stays bounded.
          Body: await fs.promises.readFile(localPath),
          ContentLength: size,
          ContentType: 'application/octet-stream',
        })
      );
    } else {
      await this.putMultipart(localPath, objectKey, size);
    }
    return `s3://${this.bucket}/${objectKey}`;
  }

  async putMultipart(localPath, objectKey, size) {
    // Grow the part size for huge files so the part count stays within S3's limit.
    const partSize = plannedPartSize(size, this.partSize);
    const { UploadId: uploadId } = await this.client.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: objectKey, ContentType: 'application/octet-stream' })
    );
    const handle = await fs.promises.open(localPath, 'r');
    try {
      const parts = [];
      for (let offset = 0, number = 1; offset < size; offset += partSize, number += 1) {
        const length = Math.min(partSize, size - offset);
        const body = Buffer.alloc(length);
        await handle.read(body, 0, length, offset);
        let etag;
        for (let attempt = 1; ; attempt += 1) {
          try {
            ({ ETag: etag } = await this.client.send(
              new UploadPartCommand({
                Bucket: this.bucket,
                Key: objectKey,
                UploadId: uploadId,
                PartNumber: number,
                Body: body,
                ContentLength: length,
              })
            ));
            break;
          } catch (error) {
            if (attempt >= PART_RETRIES) throw error;
          }
        }
        parts.push({ ETag: etag, PartNumber: number });
      }
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: objectKey,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        })
      );
    } catch (error) {
      await this.client
        .send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: objectKey, UploadId: uploadId }))
        .catch(() => {});
      throw error;
    } finally {
      await handle.close();
    }
  }

  async getToFile(key, destPath) {
    const { stream } = await this.getReadStream(key);
    await pipeline(stream, fs.createWriteStream(destPath, { mode: 0o600 }));
  }

  async getReadStream(key) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) })
    );
    return { stream: response.Body, size: Number(response.ContentLength) || null };
  }

  async exists(key) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
  }

  async usage() {
    let usedBytes = 0;
    let token;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: `${this.prefix}/`, ContinuationToken: token })
      );
      for (const item of page.Contents || []) usedBytes += item.Size || 0;
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    // Object storage has no fixed capacity to report.
    return { usedBytes, availableBytes: null, totalBytes: null };
  }
}
