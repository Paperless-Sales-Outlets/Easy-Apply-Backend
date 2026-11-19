import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  S3Client,
  PutObjectCommand,
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
 * A single PutObject is used, which S3 limits to 5 GB per object.
 */
export class S3StorageAdapter extends StorageAdapter {
  constructor({ endpoint, bucket, region, accessKeyId, secretAccessKey, prefix = 'backups', forcePathStyle = true, client }) {
    super();
    this.bucket = bucket;
    this.prefix = prefix;
    this.endpoint = endpoint;
    this.client =
      client ||
      new S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
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
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: fs.createReadStream(localPath),
        ContentLength: size,
        ContentType: 'application/octet-stream',
      })
    );
    return `s3://${this.bucket}/${objectKey}`;
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
