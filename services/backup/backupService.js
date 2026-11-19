import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { getConfig, getDbConnection, publicSettings, BACKUP_TYPES } from './config.js';
import { BackupError, describeFailure, redact } from './errors.js';
import { commands } from './commands.js';
import { encryptFile, decryptFile, sha256File, getBackupKey } from './crypto.js';
import { getStorageAdapter, createStorageAdapter } from './storage/index.js';
import { acquireJobLock, getActiveJob } from './lock.js';
import { enterMaintenance, leaveMaintenance, getMaintenance } from './maintenance.js';
import { recordBackupAudit } from './auditLog.js';
import * as repo from './backupRepository.js';

// -----------------------------------------------------------------------------
// Backup / verify / test-restore / restore / delete.
//
// Long operations run as background jobs: the HTTP request returns 202 with the
// backups row straight away, and the dashboard polls GET /backups/:id. Only one
// job runs at a time (see lock.js). Nothing here ever deletes a backup on its
// own — retention is a manual decision.
// -----------------------------------------------------------------------------

export const PRE_RESTORE_NOTE = 'Auto pre-restore backup';
const MANIFEST_NAME = 'manifest.json';
const DUMP_NAME = 'database.dump';
const UPLOADS_NAME = 'uploads.tgz';

// ---- helpers ----------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

function makeFileName(type, now = new Date()) {
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const suffix = type === 'database_files' ? 'dbfiles' : 'db';
  return `slt-backup-${stamp}-${crypto.randomBytes(3).toString('hex')}.${suffix}.sltbak`;
}

/** Storage key of a backup row: "<year>/<file name>". */
export const storageKeyFor = (row) => `${new Date(row.started_at).getUTCFullYear()}/${row.file_name}`;

function adapterForRow(row) {
  const active = getStorageAdapter();
  if (!row.storage_backend || row.storage_backend === active.name) return active;
  // Stored with a different backend than the one now configured (BACKUP_STORAGE was switched).
  try {
    return createStorageAdapter({ ...getConfig(), storage: row.storage_backend });
  } catch {
    throw new BackupError(
      `This backup is stored in "${row.storage_backend}" storage, which is not available with the current settings.`,
      409,
      'STORAGE_MISMATCH'
    );
  }
}

async function makeWorkDir(prefix) {
  const { tmpDir } = getConfig();
  await fs.promises.mkdir(tmpDir, { recursive: true, mode: 0o700 });
  return fs.promises.mkdtemp(path.join(tmpDir, prefix));
}

const cleanup = (dir) => fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});

function runInBackground(label, job, release) {
  setImmediate(async () => {
    try {
      await job();
    } catch (error) {
      // Each job records its own failure; this is only the server-log trail.
      console.error(`[backup] ${label} job ended with an error: ${redact(error?.message)}`);
    } finally {
      await release();
    }
  });
}

/** Checks everything a backup needs before a row is created, so failures are immediate and readable. */
async function assertBackupReady() {
  getBackupKey(); // throws ENCRYPTION_NOT_CONFIGURED / ENCRYPTION_KEY_INVALID
  await getStorageAdapter().ensureReady();
  if (!(await commands.toolVersion(getConfig().pgDump))) {
    throw new BackupError(
      'pg_dump was not found on the server. Install the PostgreSQL client tools or set PG_DUMP_PATH.',
      503,
      'TOOL_MISSING'
    );
  }
}

async function assertRestoreToolsReady() {
  if (!(await commands.toolVersion(getConfig().pgRestore))) {
    throw new BackupError(
      'pg_restore was not found on the server. Install the PostgreSQL client tools or set PG_RESTORE_PATH.',
      503,
      'TOOL_MISSING'
    );
  }
}

function limitError(max, forRestore = false) {
  return new BackupError(
    forRestore
      ? `The ${max}-backup limit has been reached. A restore first takes an automatic safety backup, so delete at least one old backup before restoring.`
      : `The ${max}-backup limit has been reached. Delete old backups you no longer need, then try again. Nothing is ever deleted automatically.`,
    409,
    'BACKUP_LIMIT_REACHED'
  );
}

const actorSummary = (actor) => ({ id: actor?.id || null, name: actor?.name || null });

async function getRowOrThrow(id) {
  const row = await repo.getBackup(id);
  if (!row) throw new BackupError('Backup not found.', 404, 'NOT_FOUND');
  return row;
}

function assertUsable(row) {
  if (row.status !== 'success') {
    throw new BackupError('Only a successfully completed backup can be used for this action.', 409, 'BACKUP_NOT_READY');
  }
}

// ---- create -----------------------------------------------------------------

/**
 * Validates the request, takes the lock, records an "in progress" row and starts
 * the job in the background. Returns the new row immediately.
 */
export async function startBackup({ type, note, actor }) {
  if (!BACKUP_TYPES.includes(type)) {
    throw new BackupError('Choose a backup type: "Full database" or "Database + uploaded files".', 400, 'INVALID_TYPE');
  }
  const cleanNote = String(note ?? '').trim();
  if (cleanNote.length < 3) {
    throw new BackupError('A note or reason is required (at least 3 characters).', 400, 'NOTE_REQUIRED');
  }
  if (cleanNote.length > 500) {
    throw new BackupError('The note is too long (500 characters maximum).', 400, 'NOTE_TOO_LONG');
  }
  await assertBackupReady();

  const release = await acquireJobLock({ op: 'backup' });
  try {
    const { maxBackups } = getConfig();
    if ((await repo.countStoredBackups()) >= maxBackups) throw limitError(maxBackups);

    const row = await repo.insertBackup({
      fileName: makeFileName(type),
      type,
      purpose: 'manual',
      note: cleanNote,
      actor,
      storageBackend: getStorageAdapter().name,
    });
    runInBackground('backup', () => executeBackup(row, actor), release);
    return repo.presentBackup(row);
  } catch (error) {
    await release();
    throw error;
  }
}

/**
 * The backup pipeline. The caller holds the job lock. On failure the row is
 * marked failed, any half-stored file is removed, and the error is re-thrown.
 */
export async function executeBackup(row, actor) {
  const started = Date.now();
  const config = getConfig();
  const adapter = adapterForRow(row);
  const key = storageKeyFor(row);
  const work = await makeWorkDir('backup-');
  let stored = false;
  let stage = 'starting';
  const setStage = async (next) => {
    stage = next;
    await repo.updateBackup(row.id, { stage: next });
  };

  try {
    const stageDir = path.join(work, 'bundle');
    await fs.promises.mkdir(stageDir);

    await setStage('dumping_database');
    await commands.pgDump(path.join(stageDir, DUMP_NAME));

    const manifest = {
      format: 1,
      createdAt: new Date().toISOString(),
      type: row.backup_type,
      purpose: row.purpose,
      database: getDbConnection().database,
      files: { included: false },
    };

    if (row.backup_type === 'database_files') {
      await setStage('archiving_files');
      const hasUploads = fs.existsSync(config.uploadsPath);
      if (hasUploads) await commands.tarCreate(path.join(stageDir, UPLOADS_NAME), config.uploadsPath, { gzip: true });
      manifest.files = { included: hasUploads, source: 'uploads folder' };
    }
    await fs.promises.writeFile(path.join(stageDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2));

    await setStage('bundling');
    const bundle = path.join(work, 'bundle.tar');
    await commands.tarCreate(bundle, stageDir);

    await setStage('encrypting');
    const encrypted = path.join(work, 'backup.sltbak');
    const { size, sha256 } = await encryptFile(bundle, encrypted);

    await setStage('uploading');
    const location = await adapter.put(encrypted, key);
    stored = true;

    await setStage('verifying');
    const copy = path.join(work, 'stored-copy.sltbak');
    await adapter.getToFile(key, copy);
    if ((await sha256File(copy)) !== sha256) {
      throw new BackupError('The stored file does not match its checksum.', 500, 'CHECKSUM_MISMATCH');
    }

    const finishedAt = new Date();
    const durationMs = Date.now() - started;
    const done = await repo.updateBackup(row.id, {
      status: 'success',
      stage: null,
      errorMessage: null,
      finishedAt,
      durationMs,
      sizeBytes: size,
      checksum: sha256,
      storagePath: location,
    });
    await recordBackupAudit({
      backup: row,
      action: 'created',
      actor,
      details: { type: row.backup_type, purpose: row.purpose, note: row.note, sizeBytes: size, durationMs },
    });
    console.log(`[backup] ${row.id} completed in ${durationMs} ms (${size} bytes)`);
    return done;
  } catch (error) {
    console.error(`[backup] ${row.id} failed during "${stage}": ${redact(error?.message)}`);
    if (error?.detail) console.error(`[backup] detail: ${redact(error.detail)}`);
    if (stored) await adapter.delete(key).catch(() => {});
    const summary = `Failed while ${stage.replace(/_/g, ' ')}: ${describeFailure(error)}`;
    await repo
      .updateBackup(row.id, { status: 'failed', stage: null, errorMessage: summary, finishedAt: new Date(), durationMs: Date.now() - started })
      .catch(() => {});
    await recordBackupAudit({
      backup: row,
      action: 'failed',
      actor,
      result: 'failure',
      details: { stage, error: describeFailure(error), purpose: row.purpose },
    });
    throw error;
  } finally {
    await cleanup(work);
  }
}

// ---- reading an existing backup --------------------------------------------

const TABLE_LINE = /^\d+;\s+\d+\s+\d+\s+TABLE\s+public\s+(\S+)\s/;
export const tablesFromToc = (toc) =>
  String(toc)
    .split(/\r?\n/)
    .map((line) => TABLE_LINE.exec(line)?.[1])
    .filter(Boolean);

/**
 * Brings a stored backup into `work`: downloads it, checks the SHA-256, decrypts
 * (the GCM tag also proves it was not altered), unpacks and reads the dump's
 * table of contents. Returns the paths and a list of passed checks.
 */
async function unpackBackup(row, work) {
  const adapter = adapterForRow(row);
  const key = storageKeyFor(row);
  const checks = [];

  if (!(await adapter.exists(key))) {
    throw new BackupError('The backup file is missing from storage.', 404, 'FILE_MISSING');
  }
  checks.push({ name: 'File present in storage', ok: true });

  const encrypted = path.join(work, 'download.sltbak');
  await adapter.getToFile(key, encrypted);
  const actual = await sha256File(encrypted);
  if (!row.checksum_sha256 || actual !== row.checksum_sha256) {
    throw new BackupError(
      'The SHA-256 checksum does not match the one recorded at backup time. The file may be corrupted or altered.',
      422,
      'CHECKSUM_MISMATCH'
    );
  }
  checks.push({ name: 'SHA-256 checksum matches', ok: true, detail: `${actual.slice(0, 16)}…` });

  const bundle = path.join(work, 'bundle.tar');
  await decryptFile(encrypted, bundle);
  checks.push({ name: 'Decrypts and passes authentication', ok: true });

  const stageDir = path.join(work, 'unpacked');
  await fs.promises.mkdir(stageDir);
  await commands.tarExtract(bundle, stageDir);
  const dumpFile = path.join(stageDir, DUMP_NAME);
  if (!fs.existsSync(dumpFile)) {
    throw new BackupError('The backup does not contain a database dump.', 422, 'BACKUP_CORRUPT');
  }

  const toc = await commands.pgRestoreList(dumpFile);
  const tables = tablesFromToc(toc);
  if (!tables.length) {
    throw new BackupError('The database dump lists no tables.', 422, 'BACKUP_CORRUPT');
  }
  checks.push({ name: 'pg_restore --list reads the archive', ok: true, detail: `${tables.length} tables` });

  return { stageDir, dumpFile, tables, checks, uploadsArchive: path.join(stageDir, UPLOADS_NAME) };
}

// ---- verify -----------------------------------------------------------------

export async function startVerify({ id, actor }) {
  const row = await getRowOrThrow(id);
  assertUsable(row);
  await assertRestoreToolsReady();
  getBackupKey();

  const release = await acquireJobLock({ op: 'verify', backupId: id });
  try {
    const running = { status: 'running', startedAt: new Date().toISOString(), startedBy: actorSummary(actor) };
    const updated = await repo.updateBackup(id, { verifyResult: running });
    runInBackground('verify', () => executeVerify(row, actor, running), release);
    return repo.presentBackup(updated);
  } catch (error) {
    await release();
    throw error;
  }
}

export async function executeVerify(row, actor, running = { startedAt: new Date().toISOString() }) {
  const work = await makeWorkDir('verify-');
  let result;
  try {
    const { checks } = await unpackBackup(row, work);
    result = { ...running, status: 'passed', checks, finishedAt: new Date().toISOString() };
  } catch (error) {
    console.error(`[backup] verify ${row.id} failed: ${redact(error?.message)}`);
    result = { ...running, status: 'failed', error: describeFailure(error), finishedAt: new Date().toISOString() };
  } finally {
    await cleanup(work);
  }
  await repo.updateBackup(row.id, { verifyResult: result });
  await recordBackupAudit({
    backup: row,
    action: 'verified',
    actor,
    result: result.status === 'passed' ? 'success' : 'failure',
    details: { error: result.error, checks: result.checks?.length },
  });
  return result;
}

// ---- test restore -----------------------------------------------------------

const clientConfig = (database) => {
  const c = getDbConnection();
  return {
    host: c.host,
    port: Number(c.port),
    user: c.user,
    password: c.password,
    database,
    ssl: c.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15000,
  };
};

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

export async function startTestRestore({ id, actor }) {
  const row = await getRowOrThrow(id);
  assertUsable(row);
  await assertRestoreToolsReady();
  getBackupKey();

  const release = await acquireJobLock({ op: 'test restore', backupId: id });
  try {
    const running = { status: 'running', startedAt: new Date().toISOString(), startedBy: actorSummary(actor) };
    const updated = await repo.updateBackup(id, { testRestoreResult: running });
    runInBackground('test restore', () => executeTestRestore(row, actor, running), release);
    return repo.presentBackup(updated);
  } catch (error) {
    await release();
    throw error;
  }
}

/** Restores into a throw-away database, counts rows per table, then drops it. The live database is never touched. */
export async function executeTestRestore(row, actor, running = { startedAt: new Date().toISOString() }) {
  const started = Date.now();
  const work = await makeWorkDir('testrestore-');
  const tempDb = `slt_backup_test_${crypto.randomBytes(6).toString('hex')}`; // hex only: safe to quote
  const adminDb = getConfig().adminDatabase;
  let created = false;
  let result;

  try {
    const { dumpFile, tables: expected, checks } = await unpackBackup(row, work);

    const admin = new pg.Client(clientConfig(adminDb));
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${quoteIdent(tempDb)}`);
      created = true;
    } catch (error) {
      console.error(`[backup] CREATE DATABASE failed: ${redact(error.message)}`);
      throw new BackupError(
        'The database user is not allowed to create the temporary test database. Grant CREATEDB (see docs/BACKUP_AND_RESTORE.md).',
        500,
        'CREATEDB_DENIED'
      );
    } finally {
      await admin.end().catch(() => {});
    }
    checks.push({ name: 'Temporary database created', ok: true });

    const temp = new pg.Client(clientConfig(tempDb));
    await temp.connect();
    try {
      // The schema's UUID defaults need this extension; ignore if it is unavailable or already provided.
      await temp.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"').catch(() => {});
      await commands.pgRestore(dumpFile, tempDb, { replace: false });
      checks.push({ name: 'pg_restore into temporary database', ok: true });

      const present = (
        await temp.query(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
        )
      ).rows.map((r) => r.table_name);

      const tableCounts = [];
      for (const name of present) {
        const { rows } = await temp.query(`SELECT COUNT(*)::bigint AS n FROM public.${quoteIdent(name)}`);
        tableCounts.push({ name, rows: Number(rows[0].n) });
      }
      const missing = expected.filter((name) => !present.includes(name));
      if (missing.length) {
        throw new BackupError(`Tables missing after restore: ${missing.slice(0, 10).join(', ')}.`, 422, 'RESTORE_INCOMPLETE');
      }
      checks.push({ name: 'All tables restored', ok: true, detail: `${present.length} of ${expected.length}` });

      result = {
        ...running,
        status: 'passed',
        checks,
        tables: tableCounts,
        totalRows: tableCounts.reduce((sum, t) => sum + t.rows, 0),
        durationMs: Date.now() - started,
        finishedAt: new Date().toISOString(),
      };
    } finally {
      await temp.end().catch(() => {});
    }
  } catch (error) {
    console.error(`[backup] test restore ${row.id} failed: ${redact(error?.message)}`);
    if (error?.detail) console.error(`[backup] detail: ${redact(error.detail)}`);
    result = {
      ...running,
      status: 'failed',
      error: describeFailure(error),
      durationMs: Date.now() - started,
      finishedAt: new Date().toISOString(),
    };
  } finally {
    // Always drop the temporary database, whatever happened above.
    if (created) {
      const admin = new pg.Client(clientConfig(adminDb));
      try {
        await admin.connect();
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(tempDb)} WITH (FORCE)`).catch(() =>
          admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(tempDb)}`)
        );
        if (result) result.tempDatabaseDropped = true;
      } catch (error) {
        console.error(`[backup] COULD NOT DROP TEMP DATABASE ${tempDb}: ${redact(error.message)}`);
        if (result) result.tempDatabaseDropped = false;
      } finally {
        await admin.end().catch(() => {});
      }
    }
    await cleanup(work);
  }

  await repo.updateBackup(row.id, { testRestoreResult: result });
  await recordBackupAudit({
    backup: row,
    action: 'test_restored',
    actor,
    result: result.status === 'passed' ? 'success' : 'failure',
    details: { error: result.error, tables: result.tables?.length, totalRows: result.totalRows, tempDatabaseDropped: result.tempDatabaseDropped },
  });
  return result;
}

// ---- restore ----------------------------------------------------------------

/**
 * Starts a restore. The caller (controller) has already checked the typed
 * "RESTORE" confirmation and the password. Returns immediately; the job:
 *   1. takes an automatic "Auto pre-restore backup" of the current database,
 *   2. unpacks and verifies the chosen backup,
 *   3. replaces the data in one transaction while the API is in maintenance mode.
 */
export async function startRestore({ id, actor }) {
  const row = await getRowOrThrow(id);
  assertUsable(row);
  await assertBackupReady();
  await assertRestoreToolsReady();

  const release = await acquireJobLock({ op: 'restore', backupId: id });
  try {
    const { maxBackups } = getConfig();
    if ((await repo.countStoredBackups()) >= maxBackups) throw limitError(maxBackups, true);

    const preRow = await repo.insertBackup({
      fileName: makeFileName('database'),
      type: 'database',
      purpose: 'pre_restore',
      note: PRE_RESTORE_NOTE,
      actor,
      storageBackend: getStorageAdapter().name,
    });
    const running = {
      status: 'running',
      stage: 'pre_restore_backup',
      startedAt: new Date().toISOString(),
      startedBy: actorSummary(actor),
      preRestoreBackupId: preRow.id,
    };
    const updated = await repo.updateBackup(id, { restoreResult: running });
    runInBackground('restore', () => executeRestore(row, preRow, actor, running), release);
    return repo.presentBackup(updated);
  } catch (error) {
    await release();
    throw error;
  }
}

export async function executeRestore(row, preRow, actor, running) {
  const started = Date.now();
  const work = await makeWorkDir('restore-');
  const setState = (patch) => repo.updateBackup(row.id, { restoreResult: { ...running, ...patch } });
  let replaced = false;

  try {
    // 1. Safety backup of what is live right now. If this fails, nothing has been changed.
    try {
      await executeBackup(preRow, actor);
    } catch (error) {
      throw new BackupError(
        'Restore cancelled: the automatic safety backup of the current data failed, so nothing was changed.',
        500,
        'PRE_RESTORE_FAILED'
      );
    }

    // 2. Unpack and verify the backup to restore.
    await setState({ stage: 'verifying_backup' });
    const { dumpFile, uploadsArchive } = await unpackBackup(row, work);

    // 3. Replace the data. The API answers 503 to everyone else meanwhile.
    await setState({ stage: 'restoring_database' });
    enterMaintenance('restore');
    try {
      await commands.pgRestore(dumpFile, getDbConnection().database, { replace: true });
      replaced = true;
    } finally {
      leaveMaintenance();
    }

    // 4. Uploaded files, for "Database + uploaded files" backups. The old folder is kept next to it.
    if (row.backup_type === 'database_files' && fs.existsSync(uploadsArchive)) {
      await setState({ stage: 'restoring_files' });
      const { uploadsPath } = getConfig();
      const incoming = `${uploadsPath}.restoring`;
      await cleanup(incoming);
      await fs.promises.mkdir(incoming, { recursive: true });
      await commands.tarExtract(uploadsArchive, incoming);
      if (fs.existsSync(uploadsPath)) {
        await fs.promises.rename(uploadsPath, `${uploadsPath}.before-restore-${Date.now()}`);
      }
      await fs.promises.rename(incoming, uploadsPath);
    }

    const finished = { status: 'success', stage: null, finishedAt: new Date().toISOString(), durationMs: Date.now() - started };
    await setState(finished);
    await recordBackupAudit({
      backup: row,
      action: 'restored',
      actor,
      details: { preRestoreBackupId: preRow.id, durationMs: finished.durationMs },
    });
    console.log(`[backup] restore of ${row.id} completed in ${finished.durationMs} ms`);
  } catch (error) {
    console.error(`[backup] restore of ${row.id} failed: ${redact(error?.message)}`);
    if (error?.detail) console.error(`[backup] detail: ${redact(error.detail)}`);
    const message = describeFailure(error);
    await setState({
      status: 'failed',
      stage: null,
      error: replaced
        ? `${message} The database was restored but a later step failed.`
        : `${message} The live data was not changed.`,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    }).catch(() => {});
    await recordBackupAudit({
      backup: row,
      action: 'restored',
      actor,
      result: 'failure',
      details: { error: message, preRestoreBackupId: preRow.id, databaseReplaced: replaced },
    });
  } finally {
    leaveMaintenance();
    await cleanup(work);
  }
}

// ---- delete -----------------------------------------------------------------

export async function deleteBackup({ id, actor }) {
  const row = await getRowOrThrow(id);
  try {
    if (row.status === 'in_progress') {
      throw new BackupError('This backup is still running and cannot be deleted.', 409, 'BACKUP_RUNNING');
    }
    const active = getActiveJob();
    if (active?.backupId === id) {
      throw new BackupError(`An operation (${active.op}) is running on this backup. Wait for it to finish.`, 409, 'BACKUP_BUSY');
    }
    if (row.status === 'success') {
      const latest = await repo.latestSuccessful();
      if (latest?.id === row.id) {
        throw new BackupError(
          'The most recent successful backup cannot be deleted. Create a newer backup first.',
          409,
          'LATEST_BACKUP'
        );
      }
      const adapter = adapterForRow(row);
      try {
        await adapter.delete(storageKeyFor(row));
      } catch (error) {
        console.error(`[backup] storage delete failed for ${row.id}: ${redact(error?.message)}`);
        throw new BackupError('The file could not be removed from storage, so the backup was kept.', 500, 'STORAGE_DELETE_FAILED');
      }
    }
    await repo.deleteBackupRow(id);
    await recordBackupAudit({
      backup: row,
      action: 'deleted',
      actor,
      details: { note: row.note, sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes), status: row.status },
    });
    return { id };
  } catch (error) {
    await recordBackupAudit({
      backup: row,
      action: 'deleted',
      actor,
      result: 'failure',
      details: { error: describeFailure(error) },
    });
    throw error;
  }
}

// ---- download ---------------------------------------------------------------

/** Confirms the file exists before a link is issued. */
export async function assertDownloadable(id) {
  const row = await getRowOrThrow(id);
  assertUsable(row);
  if (!(await adapterForRow(row).exists(storageKeyFor(row)))) {
    throw new BackupError('The backup file is missing from storage.', 404, 'FILE_MISSING');
  }
  return row;
}

/** Opens the stored file for streaming to the client. */
export async function openDownload(id) {
  const row = await getRowOrThrow(id);
  assertUsable(row);
  const { stream, size } = await adapterForRow(row).getReadStream(storageKeyFor(row));
  return { row, stream, size };
}

// ---- dashboard data -----------------------------------------------------------

export async function getSummary() {
  const { warningDays, maxBackups } = getConfig();
  const [last, latest, totals] = await Promise.all([repo.latestSuccessful(), repo.latestAny(), repo.totals()]);
  const stored = await repo.countStoredBackups();
  const ageMs = last?.finished_at ? Date.now() - new Date(last.finished_at).getTime() : null;
  const daysSince = ageMs == null ? null : Math.floor(ageMs / 86_400_000);
  return {
    lastSuccess: last
      ? { id: last.id, finishedAt: last.finished_at, createdByName: last.created_by_name, note: last.note }
      : null,
    lastStatus: latest?.status || null,
    lastRun: latest ? repo.presentBackup(latest) : null,
    daysSinceLastSuccess: daysSince,
    warningDays,
    isStale: !last || daysSince >= warningDays,
    count: stored,
    maxBackups,
    limitReached: stored >= maxBackups,
    totalBytes: totals.bytes,
    activeJob: getActiveJob(),
    maintenance: getMaintenance(),
  };
}

export async function getSettings() {
  const settings = publicSettings();
  const config = getConfig();
  let usage = { usedBytes: null, availableBytes: null, totalBytes: null };
  let storageError = null;
  try {
    usage = await getStorageAdapter().usage();
  } catch (error) {
    storageError = 'Storage usage could not be read.';
    console.error(`[backup] storage usage failed: ${redact(error?.message)}`);
  }
  let encryptionConfigured = true;
  try {
    getBackupKey();
  } catch {
    encryptionConfigured = false;
  }
  const [pgDump, pgRestore] = await Promise.all([
    commands.toolVersion(config.pgDump),
    commands.toolVersion(config.pgRestore),
  ]);
  return { ...settings, ...usage, storageError, encryptionConfigured, tools: { pgDump, pgRestore } };
}

export async function getBackupDetail(id) {
  return repo.presentBackup(await getRowOrThrow(id));
}
