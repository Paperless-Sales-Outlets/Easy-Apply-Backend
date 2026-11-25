import { query } from '../../config/db.js';
import { recordAudit } from '../auditService.js';

// The legacy table remains readable for historical compatibility. New activity
// is written to the shared audit_logs table.

export const AUDIT_ACTIONS = ['created', 'verified', 'downloaded', 'test_restored', 'restored', 'deleted', 'failed'];

export const actorOf = (req) => ({
  id: req?.user?._id || req?.user?.id || null,
  name: req?.user?.name || req?.user?.email || null,
  role: req?.user?.role || null,
  ip: req?.ip || req?.socket?.remoteAddress || null,
});

/** Never throws: a failure to write the audit row must not hide the real outcome, but it is logged. */
export async function recordBackupAudit({ backup, action, actor, result = 'success', details = {} }) {
  try {
    const backupId = backup?.id || backup?.backup_id || null;
    const backupName = backup?.file_name || backup?.fileName || backup?.backup_name || null;
    const normalizedAction = AUDIT_ACTIONS.includes(action) ? action : 'failed';
    const actionLabel = normalizedAction.replace(/_/g, ' ');
    await recordAudit({
      actor,
      action: `BACKUP_${normalizedAction.toUpperCase()}`,
      module: 'Backups',
      targetId: backupId,
      description: `${actionLabel[0].toUpperCase()}${actionLabel.slice(1)} backup${backupName ? ` ${backupName}` : ''}${result === 'failure' ? ' failed' : ''}`,
      metadata: {
        backupId,
        backupName,
        backupAction: normalizedAction,
        result,
        ipAddress: actor?.ip ? String(actor.ip).slice(0, 64) : null,
        details: details || {},
      },
    });
  } catch (error) {
    console.error('[backup] FAILED TO WRITE AUDIT ENTRY:', error.message);
  }
}

const presentAudit = (row) => {
  const metadata = row.details?.metadata || {};
  return {
    id: row.id,
    backupId: metadata.backupId || row.details?.targetId || null,
    backupName: metadata.backupName || null,
    action: metadata.backupAction || String(row.action).replace(/^BACKUP_/, '').toLowerCase(),
    actorId: row.actor_id,
    actorName: row.details?.userName || null,
    ipAddress: row.ip_address,
    result: metadata.result || 'success',
    details: metadata.details || {},
    createdAt: row.created_at,
  };
};

function buildWhere({ action, result, from, to, search, backupId }) {
  const where = [];
  const values = [];
  const add = (sql, value) => {
    values.push(value);
    where.push(sql.replace('?', `$${values.length}`));
  };
  where.push(`details->>'module' = 'Backups'`);
  if (action) add(`details #>> '{metadata,backupAction}' = ?`, action);
  if (result) add(`details #>> '{metadata,result}' = ?`, result);
  if (backupId) add(`COALESCE(details #>> '{metadata,backupId}', details->>'targetId') = ?`, backupId);
  if (from) add('created_at >= ?', from);
  if (to) add('created_at <= ?', to);
  if (search) {
    values.push(`%${String(search).replace(/[\\%_]/g, '\\$&')}%`);
    const n = values.length;
    where.push(`(details->>'userName' ILIKE $${n} OR ip_address ILIKE $${n} OR details::text ILIKE $${n})`);
  }
  return { clause: `WHERE ${where.join(' AND ')}`, values };
}

export async function listAudit({ page = 1, limit = 25, ...filters }) {
  const { clause, values } = buildWhere(filters);
  const total = (await query(`SELECT COUNT(*)::int AS n FROM audit_logs ${clause}`, values)).rows[0].n;
  const { rows } = await query(
    `SELECT * FROM audit_logs ${clause} ORDER BY created_at DESC LIMIT ${Number(limit)} OFFSET ${(Number(page) - 1) * Number(limit)}`,
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
    `SELECT * FROM audit_logs ${clause} ORDER BY created_at DESC LIMIT ${Number(maxRows)}`,
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
