/**
 * Storage adapter interface for backup files. Implementations: LocalStorageAdapter
 * and S3StorageAdapter. The backup service only talks to this interface, so the
 * backend is chosen with BACKUP_STORAGE=local|s3 and no code change.
 *
 * Keys are relative, forward-slash paths such as "2026/slt-backup-....sltbak".
 */
export class StorageAdapter {
  /** 'local' | 's3' */
  get name() {
    throw new Error('not implemented');
  }

  /** Human-readable location, safe to show (no secrets). */
  describe() {
    throw new Error('not implemented');
  }

  /** Checks the backend is reachable and writable; throws BackupError with a clear message otherwise. */
  async ensureReady() {
    throw new Error('not implemented');
  }

  /** Stores the local file at `key`. Returns the stored location string saved in backups.storage_path. */
  async put(_localPath, _key) {
    throw new Error('not implemented');
  }

  /** Copies the stored object to a local file. */
  async getToFile(_key, _destPath) {
    throw new Error('not implemented');
  }

  /** Returns { stream, size } for streaming a download. */
  async getReadStream(_key) {
    throw new Error('not implemented');
  }

  async exists(_key) {
    throw new Error('not implemented');
  }

  /** Deletes the object. Must not throw when it is already gone. */
  async delete(_key) {
    throw new Error('not implemented');
  }

  /** { usedBytes, availableBytes|null, totalBytes|null } for the storage tab. */
  async usage() {
    throw new Error('not implemented');
  }
}

/** Rejects keys that could escape the storage root. */
export function assertSafeKey(key) {
  const text = String(key ?? '');
  if (
    !text ||
    text.startsWith('/') ||
    text.includes('\\') ||
    text.includes('\0') ||
    text.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new Error('Invalid storage key');
  }
  return text;
}
