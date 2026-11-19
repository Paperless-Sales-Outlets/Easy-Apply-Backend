import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { BackupError } from './errors.js';

// -----------------------------------------------------------------------------
// Streaming AES-256-GCM encryption for backup files. Backups can be large, so
// nothing is loaded into memory.
//
// File format (.sltbak):
//   [4 bytes  "SLTB"] [1 byte version=1] [12 bytes IV] [ciphertext ...] [16 bytes GCM tag]
//
// The key comes ONLY from BACKUP_ENCRYPTION_KEY (64 hex chars or base64 of 32
// bytes). There is deliberately no fallback: a backup that silently used a
// guessable key would be worse than no backup.
// -----------------------------------------------------------------------------

const MAGIC = Buffer.from('SLTB');
const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
export const HEADER_LENGTH = MAGIC.length + 1 + IV_LENGTH;

export function getBackupKey() {
  const raw = (process.env.BACKUP_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    throw new BackupError(
      'Backup encryption is not configured. Ask the server administrator to set BACKUP_ENCRYPTION_KEY.',
      503,
      'ENCRYPTION_NOT_CONFIGURED'
    );
  }
  let key = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, 'hex');
  else {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) key = decoded;
  }
  if (!key) {
    throw new BackupError(
      'BACKUP_ENCRYPTION_KEY is invalid: it must be 32 random bytes written as 64 hex characters (or base64).',
      503,
      'ENCRYPTION_KEY_INVALID'
    );
  }
  return key;
}

/** SHA-256 of a file, streamed. */
export async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

/** Encrypts inPath into outPath. Returns { size, sha256 } of the ENCRYPTED file. */
export async function encryptFile(inPath, outPath, key = getBackupKey()) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), iv]);
  const hash = crypto.createHash('sha256');
  let size = 0;

  const encrypt = new Transform({
    construct(callback) {
      this.push(header);
      callback();
    },
    transform(chunk, _enc, callback) {
      callback(null, cipher.update(chunk));
    },
    flush(callback) {
      this.push(cipher.final());
      this.push(cipher.getAuthTag());
      callback();
    },
  });
  const tap = new Transform({
    transform(chunk, _enc, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });

  await pipeline(
    fs.createReadStream(inPath),
    encrypt,
    tap,
    fs.createWriteStream(outPath, { mode: 0o600 })
  );
  return { size, sha256: hash.digest('hex') };
}

/** Decrypts inPath into outPath, verifying the GCM tag. Throws BackupError on a wrong key or tampering. */
export async function decryptFile(inPath, outPath, key = getBackupKey()) {
  const { size } = await fs.promises.stat(inPath);
  if (size < HEADER_LENGTH + TAG_LENGTH) {
    throw new BackupError('The backup file is too small to be valid.', 422, 'BACKUP_CORRUPT');
  }
  const handle = await fs.promises.open(inPath, 'r');
  let header;
  let tag;
  try {
    header = Buffer.alloc(HEADER_LENGTH);
    await handle.read(header, 0, HEADER_LENGTH, 0);
    tag = Buffer.alloc(TAG_LENGTH);
    await handle.read(tag, 0, TAG_LENGTH, size - TAG_LENGTH);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, 4).equals(MAGIC) || header[4] !== VERSION) {
    throw new BackupError('This file is not a recognised backup (bad header).', 422, 'BACKUP_CORRUPT');
  }
  const iv = header.subarray(5, HEADER_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      fs.createReadStream(inPath, { start: HEADER_LENGTH, end: size - TAG_LENGTH - 1 }),
      decipher,
      fs.createWriteStream(outPath, { mode: 0o600 })
    );
  } catch (error) {
    await fs.promises.rm(outPath, { force: true });
    throw new BackupError(
      'The backup could not be decrypted. The encryption key is wrong or the file has been altered.',
      422,
      'DECRYPT_FAILED'
    );
  }
}
