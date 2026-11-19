import { getConfig } from '../config.js';
import { BackupError } from '../errors.js';
import { LocalStorageAdapter } from './LocalStorageAdapter.js';
import { S3StorageAdapter } from './S3StorageAdapter.js';

let override = null;

/** Tests inject a fake adapter here; pass null to go back to the configured one. */
export const setStorageAdapterForTests = (adapter) => {
  override = adapter;
};

/** Builds the adapter selected by BACKUP_STORAGE (local | s3). Default: local. */
export function createStorageAdapter(config = getConfig()) {
  if (config.storage === 'local') return new LocalStorageAdapter({ rootDir: config.localPath });
  if (config.storage === 's3') return new S3StorageAdapter(config.s3);
  throw new BackupError(
    `BACKUP_STORAGE must be "local" or "s3" (got "${config.storage}").`,
    503,
    'STORAGE_NOT_CONFIGURED'
  );
}

export const getStorageAdapter = () => override || createStorageAdapter();

export { StorageAdapter } from './StorageAdapter.js';
export { LocalStorageAdapter } from './LocalStorageAdapter.js';
export { S3StorageAdapter } from './S3StorageAdapter.js';
