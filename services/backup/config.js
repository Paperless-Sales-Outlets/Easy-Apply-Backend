import os from 'node:os';
import path from 'node:path';
import 'dotenv/config';
import { BackupError } from './errors.js';

// All backup settings come from environment variables and are read on every
// call (not cached), so tests and operators can change them without a restart
// of the module graph. Nothing secret is ever returned by `publicSettings`.

const int = (value, fallback, { min = 1 } = {}) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
};

export const BACKUP_TYPES = ['database', 'database_files'];

export const getConfig = () => ({
  storage: (process.env.BACKUP_STORAGE || 'local').trim().toLowerCase(),
  localPath: path.resolve(
    process.env.BACKUP_LOCAL_PATH || path.join(process.cwd(), '..', 'slt-backups')
  ),
  s3: {
    endpoint: process.env.BACKUP_S3_ENDPOINT || '',
    bucket: process.env.BACKUP_S3_BUCKET || '',
    region: process.env.BACKUP_S3_REGION || 'ap-southeast-1',
    accessKeyId: process.env.BACKUP_S3_ACCESS_KEY || '',
    secretAccessKey: process.env.BACKUP_S3_SECRET_KEY || '',
    prefix: (process.env.BACKUP_S3_PREFIX || 'backups').replace(/^\/+|\/+$/g, ''),
    forcePathStyle: process.env.BACKUP_S3_FORCE_PATH_STYLE !== 'false',
  },
  maxBackups: int(process.env.BACKUP_MAX_COUNT, 30),
  warningDays: int(process.env.BACKUP_WARNING_DAYS, 7),
  tmpDir: path.resolve(process.env.BACKUP_TMP_DIR || path.join(os.tmpdir(), 'slt-backup')),
  uploadsPath: path.resolve(process.env.BACKUP_UPLOADS_PATH || path.join(process.cwd(), 'uploads')),
  pgDump: process.env.PG_DUMP_PATH || 'pg_dump',
  pgRestore: process.env.PG_RESTORE_PATH || 'pg_restore',
  tar: process.env.BACKUP_TAR_PATH || 'tar',
  lowPriority: process.env.BACKUP_LOW_PRIORITY !== 'false' && process.platform !== 'win32',
  downloadTtlSec: int(process.env.BACKUP_DOWNLOAD_TTL_SEC, 60),
  commandTimeoutMs: int(process.env.BACKUP_COMMAND_TIMEOUT_MIN, 120) * 60 * 1000,
  // Database used for CREATE/DROP DATABASE during test restores.
  adminDatabase: process.env.BACKUP_ADMIN_DATABASE || 'postgres',
});

/** The tables that hold backup history; never included in a dump or touched by a restore. */
export const EXCLUDED_TABLES = ['backups', 'backup_audit_logs'];

const parseConnection = (raw, { database } = {}) => {
  const url = new URL(raw);
  const sslmode = url.searchParams.get('sslmode');
  const useSsl =
    process.env.DATABASE_SSL === 'true' ||
    (process.env.DATABASE_SSL !== 'false' && Boolean(sslmode && sslmode !== 'disable'));
  return {
    host: url.hostname || '127.0.0.1',
    port: url.port || '5432',
    user: decodeURIComponent(url.username || 'postgres'),
    password: decodeURIComponent(url.password || ''),
    database: database || decodeURIComponent(url.pathname.replace(/^\/+/, '') || 'paperlessoutlet'),
    ssl: useSsl,
    pgbouncer: url.searchParams.get('pgbouncer') === 'true',
  };
};

/**
 * True for a TRANSACTION-mode pooler (Supabase port 6543, or PgBouncer flagged in the URL).
 * pg_dump / pg_restore need a session-level connection, so these are refused.
 *
 * A SESSION-mode pooler is fine: on Supabase that is the same "pooler" host on port 5432
 * (a good choice when the direct host is IPv6-only and the network has no IPv6). So the host
 * name is deliberately NOT checked, only the port and the pgbouncer flag.
 */
export const isPoolerConnection = (connection) =>
  String(connection.port) === '6543' || connection.pgbouncer === true;

/**
 * Connection used by backup and restore. BACKUP_DATABASE_URL (the DIRECT
 * connection, e.g. Supabase port 5432) wins over DATABASE_URL. A pooler address
 * is refused with a clear message: pg_dump needs a session-level connection and
 * a restore must run as one transaction.
 */
export const getDbConnection = () => {
  const explicit = process.env.BACKUP_DATABASE_URL;
  const raw =
    explicit ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URI ||
    'postgresql://postgres:postgres@127.0.0.1:5432/paperlessoutlet';
  const connection = parseConnection(raw);
  if (isPoolerConnection(connection)) {
    throw new BackupError(
      explicit
        ? 'BACKUP_DATABASE_URL points at a transaction-mode pooler (port 6543). Backups need a session connection: the direct database (port 5432) or the session pooler (the same pooler host on port 5432).'
        : 'Backups cannot use the pooled DATABASE_URL (transaction mode, port 6543). Set BACKUP_DATABASE_URL to the direct database connection string, or to the session pooler string (same host, port 5432).',
      503,
      'DB_POOLER_NOT_ALLOWED'
    );
  }
  return connection;
};

/**
 * Where "Test restore" may CREATE/DROP its temporary database: BACKUP_TEST_RESTORE_URL
 * (a separate server, if the main one does not allow CREATEDB), otherwise the backup
 * connection with BACKUP_ADMIN_DATABASE.
 */
export const getTestRestoreConnection = () => {
  const explicit = process.env.BACKUP_TEST_RESTORE_URL;
  if (!explicit) return { ...getDbConnection(), database: getConfig().adminDatabase, separate: false };
  const connection = parseConnection(explicit);
  if (isPoolerConnection(connection)) {
    throw new BackupError(
      'BACKUP_TEST_RESTORE_URL points at a transaction-mode pooler (port 6543). Use a direct or session connection (port 5432).',
      503,
      'DB_POOLER_NOT_ALLOWED'
    );
  }
  return { ...connection, separate: true };
};

/** Environment for libpq tools (pg_dump / pg_restore) — keeps the password off the command line. */
export const pgEnv = (connection, database = connection.database) => ({
  ...process.env,
  PGHOST: connection.host,
  PGPORT: String(connection.port),
  PGUSER: connection.user,
  PGPASSWORD: connection.password,
  PGDATABASE: database,
  ...(connection.ssl ? { PGSSLMODE: process.env.PGSSLMODE || 'require' } : {}),
});

/** Settings that are safe to show in the UI: no keys, no passwords. */
export const publicSettings = () => {
  const config = getConfig();
  const isS3 = config.storage === 's3';
  let s3Host = '';
  try {
    s3Host = config.s3.endpoint ? new URL(config.s3.endpoint).host : 'AWS S3';
  } catch {
    s3Host = '(invalid endpoint)';
  }
  return {
    storageBackend: config.storage,
    storageLocation: isS3
      ? `${s3Host} / ${config.s3.bucket || '(no bucket)'} / ${config.s3.prefix}`
      : config.localPath,
    maxBackups: config.maxBackups,
    warningDays: config.warningDays,
    downloadLinkTtlSec: config.downloadTtlSec,
    schedule: 'manual',
  };
};
