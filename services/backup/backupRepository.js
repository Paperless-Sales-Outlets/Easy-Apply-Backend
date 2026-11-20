import { query } from '../../config/db.js';

// SQL for the `backups` table. Kept separate from the job logic so the service
// reads as a sequence of steps.

const COLUMNS = {
  status: 'status',
  stage: 'stage',
  errorMessage: 'error_message',
  finishedAt: 'finished_at',
  durationMs: 'duration_ms',
  sizeBytes: 'size_bytes',
  checksum: 'checksum_sha256',
  storagePath: 'storage_path',
  verifyResult: 'verify_result',
  testRestoreResult: 'test_restore_result',
  restoreResult: 'restore_result',
  contents: 'contents',
};
const JSON_COLUMNS = new Set(['verifyResult', 'testRestoreResult', 'restoreResult', 'contents']);

export const presentBackup = (row) =>
  row && {
    id: row.id,
    fileName: row.file_name,
    type: row.backup_type,
    purpose: row.purpose,
    note: row.note,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    checksum: row.checksum_sha256,
    status: row.status,
    stage: row.stage,
    errorMessage: row.error_message,
    storageBackend: row.storage_backend,
    storagePath: row.storage_path,
    verifyResult: row.verify_result,
    testRestoreResult: row.test_restore_result,
    restoreResult: row.restore_result,
    contents: row.contents,
  };

export async function insertBackup({ fileName, type, purpose, note, actor, storageBackend }) {
  const { rows } = await query(
    `INSERT INTO backups (file_name, backup_type, purpose, note, created_by, created_by_name, storage_backend, status, stage)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'in_progress', 'starting')
     RETURNING *`,
    [fileName, type, purpose, note, actor?.id || null, actor?.name || null, storageBackend]
  );
  return rows[0];
}

/** Updates the named fields (see COLUMNS). Unknown keys are ignored. */
export async function updateBackup(id, fields) {
  const sets = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!COLUMNS[key]) continue;
    values.push(JSON_COLUMNS.has(key) && value != null ? JSON.stringify(value) : value);
    sets.push(`${COLUMNS[key]} = $${values.length}${JSON_COLUMNS.has(key) ? '::jsonb' : ''}`);
  }
  if (!sets.length) return getBackup(id);
  values.push(id);
  const { rows } = await query(`UPDATE backups SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
  return rows[0] || null;
}

export async function getBackup(id) {
  const { rows } = await query('SELECT * FROM backups WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function deleteBackupRow(id) {
  await query('DELETE FROM backups WHERE id = $1', [id]);
}

/** Backups that hold (or are about to hold) a stored file — these count against the maximum. */
export async function countStoredBackups() {
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM backups WHERE status IN ('success', 'in_progress')`);
  return rows[0].n;
}

export async function latestSuccessful() {
  const { rows } = await query(
    `SELECT * FROM backups WHERE status = 'success' ORDER BY finished_at DESC NULLS LAST, started_at DESC LIMIT 1`
  );
  return rows[0] || null;
}

export async function latestAny() {
  const { rows } = await query('SELECT * FROM backups ORDER BY started_at DESC LIMIT 1');
  return rows[0] || null;
}

export async function totals() {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(size_bytes), 0)::bigint AS bytes
       FROM backups WHERE status = 'success'`
  );
  return { count: rows[0].count, bytes: Number(rows[0].bytes) };
}

/**
 * Paginated list, newest first. Filters: from/to (Date), status, type,
 * search (note, file name or id).
 */
export async function listBackups({ page = 1, limit = 15, from, to, status, type, search }) {
  const where = [];
  const values = [];
  const add = (sql, value) => {
    values.push(value);
    where.push(sql.replace('?', `$${values.length}`));
  };
  if (from) add('started_at >= ?', from);
  if (to) add('started_at <= ?', to);
  if (status) add('status = ?', status);
  if (type) add('backup_type = ?', type);
  if (search) {
    values.push(`%${String(search).replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(note ILIKE $${values.length} OR file_name ILIKE $${values.length} OR id::text ILIKE $${values.length})`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await query(`SELECT COUNT(*)::int AS n FROM backups ${clause}`, values)).rows[0].n;
  const { rows } = await query(
    `SELECT * FROM backups ${clause} ORDER BY started_at DESC LIMIT ${Number(limit)} OFFSET ${(Number(page) - 1) * Number(limit)}`,
    values
  );
  return { rows, total };
}

/**
 * On startup: anything still marked running belongs to a process that died, so
 * it can never finish. Mark it failed so the lock/UI do not look stuck.
 */
export async function failInterruptedJobs() {
  const message = 'Interrupted: the server restarted while this operation was running.';
  const finished = new Date().toISOString();
  await query(
    `UPDATE backups SET status = 'failed', stage = NULL, error_message = $1, finished_at = NOW()
      WHERE status = 'in_progress'`,
    [message]
  );
  for (const column of ['verify_result', 'test_restore_result', 'restore_result']) {
    await query(
      `UPDATE backups SET ${column} = jsonb_build_object('status', 'failed', 'error', $1::text, 'finishedAt', $2::text)
        WHERE ${column}->>'status' = 'running'`,
      [message, finished]
    );
  }
}
