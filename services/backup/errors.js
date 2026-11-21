import { AppError } from '../../middleware/errorHandler.js';
import { getDbConnection } from './config.js';

/**
 * An expected failure with a message that is safe to show to the user.
 * `code` lets the UI react (e.g. BACKUP_LIMIT_REACHED).
 */
export class BackupError extends AppError {
  constructor(message, statusCode = 400, code = 'BACKUP_ERROR') {
    super(message, statusCode);
    this.code = code;
  }
}

/**
 * Removes anything secret from text before it is logged, stored or shown:
 * connection-string credentials and the literal values of the DB password,
 * encryption key and S3 secret.
 */
export function redact(text) {
  let out = String(text ?? '');
  out = out.replace(/(postgres(?:ql)?:\/\/)([^@\s/]*)@/gi, '$1***@');
  const secrets = [
    safe(() => getDbConnection().password),
    process.env.BACKUP_ENCRYPTION_KEY,
    process.env.BACKUP_S3_SECRET_KEY,
    process.env.BACKUP_S3_ACCESS_KEY,
  ].filter((value) => value && String(value).length >= 4);
  for (const secret of secrets) out = out.split(String(secret)).join('***');
  return out;
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return '';
  }
}

/** A short, redacted summary for the UI and the backups table. */
export function describeFailure(error, max = 600) {
  if (error instanceof BackupError) return redact(error.message).slice(0, max);
  return redact(error?.message || 'Unexpected error').slice(0, max);
}
