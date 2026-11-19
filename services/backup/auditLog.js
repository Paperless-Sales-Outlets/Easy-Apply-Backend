import { query } from '../../config/db.js';

// Every backup action is written here: who, what, when, from which IP, and the
// result. The table is append-only from the application's point of view (there
// is no update or delete), and it is excluded from backups/restores so a restore
// can never erase its own trail.

export const AUDIT_ACTIONS = ['created', 'verified', 'downloaded', 'test_restored', 'restored', 'deleted', 'failed'];

export const actorOf = (req) => ({
  id: req?.user?._id || req?.user?.id || null,
  name: req?.user?.name || req?.user?.email || null,
  ip: req?.ip || req?.socket?.remoteAddress || null,
});

/** Never throws: a failure to write the audit row must not hide the real outcome, but it is logged. */
export async function recordBackupAudit({ backup, action, actor, result = 'success', details = {} }) {
  try {
    await query(
      `INSERT INTO backup_audit_logs (backup_id, backup_name, action, actor_id, actor_name, ip_address, result, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        backup?.id || null,
        backup?.file_name || backup?.fileName || null,
        action,
        actor?.id || null,
        actor?.name || null,
        actor?.ip ? String(actor.ip).slice(0, 64) : null,
        result,
        JSON.stringify(details || {}),
      ]
    );
  } catch (error) {
    console.error('[backup] FAILED TO WRITE AUDIT ENTRY:', error.message);
  }
}

const presentAudit = (row) => ({
  id: row.id,
  backupId: row.backup_id,
  backupName: row.backup_name,
  action: row.action,
  actorId: row.actor_id,
  actorName: row.actor_name,
  ipAddress: row.ip_address,
  result: row.result,
  details: row.details || {},
  createdAt: row.created_at,
});

function buildWhere({ action, result, from, to, search, backupId }) {
  const where = [];
  const values = [];
  const add = (sql, value) => {
    values.push(value);
    where.push(sql.replace('?', `$${values.length}`));
  };
  if (action) add('action = ?', action);
  if (result) add('result = ?', result);
  if (backupId) add('backup_id = ?', backupId);
  if (from) add('created_at >= ?', from);
  if (to) add('created_at <= ?', to);
  if (search) {
    values.push(`%${String(search).replace(/[\\%_]/g, '\\$&')}%`);
    const n = values.length;
    where.push(`(actor_name ILIKE $${n} OR backup_name ILIKE $${n} OR ip_address ILIKE $${n} OR details::text ILIKE $${n})`);
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', values };
}

export async function listAudit({ page = 1, limit = 25, ...filters }) {
  const { clause, values } = buildWhere(filters);
  const total = (await query(`SELECT COUNT(*)::int AS n FROM backup_audit_logs ${clause}`, values)).rows[0].n;
  const { rows } = await query(
    `SELECT * FROM backup_audit_logs ${clause} ORDER BY created_at DESC LIMIT ${Number(limit)} OFFSET ${(Number(page) - 1) * Number(limit)}`,
    values
  );
  return { rows: rows.map(presentAudit), total };
}

const CSV_COLUMNS = ['Time (UTC)', 'Action', 'Result', 'User', 'IP address', 'Backup', 'Details'];

// A cell starting with = + - @ is read as a formula by spreadsheets; neutralise it.
const csvCell = (value) => {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

export async function exportAuditCsv(filters, maxRows = 10000) {
  const { clause, values } = buildWhere(filters);
  const { rows } = await query(
    `SELECT * FROM backup_audit_logs ${clause} ORDER BY created_at DESC LIMIT ${Number(maxRows)}`,
    values
  );
  const lines = [CSV_COLUMNS.map(csvCell).join(',')];
  for (const row of rows.map(presentAudit)) {
    lines.push(
      [
        new Date(row.createdAt).toISOString(),
        row.action,
        row.result,
        row.actorName,
        row.ipAddress,
        row.backupName || row.backupId,
        JSON.stringify(row.details),
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
