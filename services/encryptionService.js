import crypto from 'node:crypto';
import 'dotenv/config';

// -----------------------------------------------------------------------------
// Document Encryption at Rest Service
// -----------------------------------------------------------------------------
// Implements authenticated AES-256-GCM envelope encryption for all sensitive
// customer KYC documents (NIC Front, NIC Back, Live Face Photo, Digital Signature).
//
// Binary Envelope Format:
// [ 4 Bytes: Magic "SLTE" (0x53, 0x4C, 0x54, 0x45) ]
// [ 1 Byte:  Envelope Version (0x01) ]
// [ 12 Bytes: GCM Nonce / IV ]
// [ 16 Bytes: GCM Authentication Tag ]
// [ N Bytes:  Encrypted Ciphertext ]
//
// Tamper-proof, authenticated, and backward-compatible with unencrypted files.
// -----------------------------------------------------------------------------

const MAGIC_HEADER = Buffer.from([0x53, 0x4c, 0x54, 0x45]); // 'SLTE'
const ENVELOPE_VERSION = 0x01;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HEADER_LENGTH = 4 + 1 + IV_LENGTH + AUTH_TAG_LENGTH; // 33 bytes

let cachedKey = null;

/**
 * Retrieves the 256-bit (32-byte) master encryption key.
 */
export function getEncryptionKey() {
  if (cachedKey) return cachedKey;

  const rawKey = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (rawKey && /^[0-9a-fA-F]{64}$/.test(rawKey.trim())) {
    cachedKey = Buffer.from(rawKey.trim(), 'hex');
    return cachedKey;
  }

  if (rawKey && rawKey.trim().length >= 32) {
    cachedKey = crypto.createHash('sha256').update(rawKey.trim()).digest();
    return cachedKey;
  }

  // Fallback: derive deterministically from JWT_ACCESS_SECRET or app secret
  const fallbackSecret = process.env.JWT_ACCESS_SECRET || 'SLT-EasyApply-Master-KYC-Encryption-Key-2026';
  cachedKey = crypto.createHash('sha256').update(fallbackSecret).digest();
  return cachedKey;
}

/**
 * Checks whether a given buffer is formatted with the SLTE encryption envelope.
 */
export function isEncryptedBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < HEADER_LENGTH) {
    return false;
  }
  return (
    buffer[0] === MAGIC_HEADER[0] &&
    buffer[1] === MAGIC_HEADER[1] &&
    buffer[2] === MAGIC_HEADER[2] &&
    buffer[3] === MAGIC_HEADER[3] &&
    buffer[4] === ENVELOPE_VERSION
  );
}

/**
 * Encrypts an arbitrary buffer using AES-256-GCM.
 * Wraps output in the tamper-proof SLTE binary envelope.
 */
export function encryptBuffer(buffer) {
  if (!buffer || buffer.length === 0) return buffer;
  const rawBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  // If already encrypted, avoid double-encrypting
  if (isEncryptedBuffer(rawBuffer)) {
    return rawBuffer;
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(rawBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([
    MAGIC_HEADER,
    Buffer.from([ENVELOPE_VERSION]),
    iv,
    authTag,
    ciphertext,
  ]);
}

/**
 * Decrypts a buffer.
 * If the buffer has the SLTE envelope, decrypts and returns original plaintext bytes.
 * If the buffer is NOT encrypted (legacy file), returns it unchanged.
 */
export function decryptBuffer(buffer) {
  if (!buffer || buffer.length === 0) return buffer;
  const rawBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  // Backward-compatibility: if not encrypted, return as-is
  if (!isEncryptedBuffer(rawBuffer)) {
    return rawBuffer;
  }

  try {
    const key = getEncryptionKey();
    const iv = rawBuffer.subarray(5, 5 + IV_LENGTH);
    const authTag = rawBuffer.subarray(5 + IV_LENGTH, HEADER_LENGTH);
    const ciphertext = rawBuffer.subarray(HEADER_LENGTH);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    console.error('Decryption failed (integrity or key mismatch):', err.message);
    throw new Error('Document decryption failed: Data may be corrupted or encrypted with a different key.');
  }
}

/**
 * Converts a base64 Data URL to an encrypted binary buffer.
 */
export function encryptDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const parts = dataUrl.split(',');
  if (parts.length < 2) return null;

  const base64Str = parts[1];
  const buffer = Buffer.from(base64Str, 'base64');
  return encryptBuffer(buffer);
}

export default {
  getEncryptionKey,
  isEncryptedBuffer,
  encryptBuffer,
  decryptBuffer,
  encryptDataUrl,
};

