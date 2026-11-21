import crypto from 'node:crypto';
import { getConfig } from './config.js';
import { BackupError } from './errors.js';

// Short-lived, single-use download links. A token is only half of the proof:
// the download request must ALSO carry the user's own bearer token, and
// the token must have been issued to that same user for that same backup, so a
// leaked link is useless on its own. Tokens live in memory (single PM2
// process); a restart simply invalidates outstanding links.

const tokens = new Map(); // tokenHash -> { userId, backupId, expiresAt }

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function sweep(now = Date.now()) {
  for (const [key, entry] of tokens) if (entry.expiresAt <= now) tokens.delete(key);
}

export function issueDownloadToken({ userId, backupId }) {
  sweep();
  const ttlSec = getConfig().downloadTtlSec;
  const token = crypto.randomBytes(32).toString('base64url');
  tokens.set(hash(token), { userId: String(userId), backupId: String(backupId), expiresAt: Date.now() + ttlSec * 1000 });
  return { token, expiresInSec: ttlSec };
}

/** Validates and burns the token. Throws 403/410 BackupError otherwise. */
export function consumeDownloadToken(token, { userId }) {
  sweep();
  const key = hash(String(token || ''));
  const entry = tokens.get(key);
  if (!entry) {
    throw new BackupError('This download link has expired or was already used. Request a new one.', 410, 'LINK_EXPIRED');
  }
  tokens.delete(key); // single use, even if the checks below fail
  if (entry.userId !== String(userId)) {
    throw new BackupError('This download link was not issued to you.', 403, 'LINK_FORBIDDEN');
  }
  return entry;
}

export const clearDownloadTokensForTests = () => tokens.clear();
