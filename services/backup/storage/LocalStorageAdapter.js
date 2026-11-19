import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { StorageAdapter, assertSafeKey } from './StorageAdapter.js';
import { BackupError } from '../errors.js';

/** Backups on a local folder. The folder should be OUTSIDE the web root and readable only by the service user. */
export class LocalStorageAdapter extends StorageAdapter {
  constructor({ rootDir }) {
    super();
    this.rootDir = path.resolve(rootDir);
  }

  get name() {
    return 'local';
  }

  describe() {
    return this.rootDir;
  }

  resolve(key) {
    const full = path.resolve(this.rootDir, assertSafeKey(key));
    if (full !== this.rootDir && !full.startsWith(this.rootDir + path.sep)) {
      throw new Error('Invalid storage key');
    }
    return full;
  }

  async ensureReady() {
    try {
      await fs.promises.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
      await fs.promises.access(this.rootDir, fs.constants.W_OK);
    } catch (error) {
      console.error('[backup] Local storage not writable:', error.message);
      throw new BackupError(
        'The backup storage folder is not writable. Check BACKUP_LOCAL_PATH and its permissions.',
        503,
        'STORAGE_NOT_READY'
      );
    }
  }

  async put(localPath, key) {
    const dest = this.resolve(key);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
    // Write to a temp name and rename so a half-copied file is never mistaken for a backup.
    const partial = `${dest}.partial`;
    await fs.promises.copyFile(localPath, partial);
    await fs.promises.chmod(partial, 0o600).catch(() => {});
    await fs.promises.rename(partial, dest);
    return dest;
  }

  async getToFile(key, destPath) {
    await pipeline(fs.createReadStream(this.resolve(key)), fs.createWriteStream(destPath, { mode: 0o600 }));
  }

  async getReadStream(key) {
    const full = this.resolve(key);
    const { size } = await fs.promises.stat(full);
    return { stream: fs.createReadStream(full), size };
  }

  async exists(key) {
    try {
      await fs.promises.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key) {
    await fs.promises.rm(this.resolve(key), { force: true });
  }

  async usage() {
    let usedBytes = 0;
    const walk = async (dir) => {
      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) usedBytes += (await fs.promises.stat(full)).size;
      }
    };
    await walk(this.rootDir);

    let availableBytes = null;
    let totalBytes = null;
    try {
      // Walk up to an existing folder: the root may not have been created yet.
      let probe = this.rootDir;
      while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
      const stats = await fs.promises.statfs(probe);
      availableBytes = Number(stats.bavail) * Number(stats.bsize);
      totalBytes = Number(stats.blocks) * Number(stats.bsize);
    } catch {
      // statfs unsupported: the UI shows "unknown".
    }
    return { usedBytes, availableBytes, totalBytes };
  }
}
