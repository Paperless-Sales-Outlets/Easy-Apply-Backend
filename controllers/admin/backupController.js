import { pipeline } from 'node:stream/promises';
import * as backups from '../../services/backup/backupService.js';
import * as repo from '../../services/backup/backupRepository.js';
import { listAudit, exportAuditCsv, recordBackupAudit, actorOf, AUDIT_ACTIONS } from '../../services/backup/auditLog.js';
import { verifyActorPassword } from '../../services/backup/reauth.js';
import { canUseBackups } from '../../services/backup/access.js';
import { issueDownloadToken, consumeDownloadToken } from '../../services/backup/downloadTokens.js';
import { BackupError, describeFailure, redact } from '../../services/backup/errors.js';
import { startOfSriLankaDay, endOfSriLankaDay } from '../../utils/sriLankaDate.js';

// Every handler here sits behind protect + requireBackupAccess (see backupRoutes.js).
// Expected failures are BackupError (safe, friendly message + code); anything
// else is logged in full on the server and shown generically.

const positiveInt = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

const pagination = (page, limit, total) => ({
  currentPage: page,
  pageSize: limit,
  totalCount: total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});

const oneOf = (value, allowed) => (allowed.includes(value) ? value : undefined);

function dateRange(query) {
  const from = query.from || query.startDate;
  const to = query.to || query.endDate;
  return {
    from: from ? startOfSriLankaDay(from) : undefined,
    to: to ? endOfSriLankaDay(to) : undefined,
  };
}

const wrap = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    if (!(error instanceof BackupError)) console.error('[backup] unexpected error:', redact(error?.stack || error?.message));
    next(error);
  }
};

/** Whether the signed-in user may use the Backup Dashboard (the frontend shows the menu item from this). */
export const getAccess = wrap(async (req, res) => {
  res.json({ success: true, allowed: canUseBackups(req.user) });
});

export const getSummary = wrap(async (req, res) => {
  res.json({ success: true, summary: await backups.getSummary() });
});

export const getSettings = wrap(async (req, res) => {
  res.json({ success: true, settings: await backups.getSettings() });
});

export const listBackups = wrap(async (req, res) => {
  const page = positiveInt(req.query.page, 1, 1_000_000);
  const limit = positiveInt(req.query.limit, 15, 100);
  const { rows, total } = await repo.listBackups({
    page,
    limit,
    ...dateRange(req.query),
    status: oneOf(req.query.status, ['in_progress', 'success', 'failed']),
    type: oneOf(req.query.type, ['database', 'database_files']),
    search: req.query.search ? String(req.query.search).trim().slice(0, 100) : undefined,
  });
  res.json({ success: true, backups: rows.map(repo.presentBackup), pagination: pagination(page, limit, total) });
});

export const getBackup = wrap(async (req, res) => {
  const backup = await backups.getBackupDetail(req.params.id);
  const { rows } = await listAudit({ backupId: req.params.id, limit: 20 });
  res.json({ success: true, backup, activity: rows });
});

export const createBackup = wrap(async (req, res) => {
  const actor = actorOf(req);
  try {
    const backup = await backups.startBackup({
      type: req.body?.type,
      note: req.body?.note,
      actor,
    });
    res.status(202).json({ success: true, message: 'Backup started.', backup });
  } catch (error) {
    await recordBackupAudit({ action: 'created', actor, result: 'failure', details: { reason: describeFailure(error) } });
    throw error;
  }
});

export const verifyBackup = wrap(async (req, res) => {
  const actor = actorOf(req);
  try {
    const backup = await backups.startVerify({ id: req.params.id, actor });
    res.status(202).json({ success: true, message: 'Verification started.', backup });
  } catch (error) {
    await recordBackupAudit({ backup: { id: req.params.id }, action: 'verified', actor, result: 'failure', details: { reason: describeFailure(error) } });
    throw error;
  }
});

export const testRestore = wrap(async (req, res) => {
  const actor = actorOf(req);
  try {
    const backup = await backups.startTestRestore({ id: req.params.id, actor });
    res.status(202).json({ success: true, message: 'Test restore started.', backup });
  } catch (error) {
    await recordBackupAudit({ backup: { id: req.params.id }, action: 'test_restored', actor, result: 'failure', details: { reason: describeFailure(error) } });
    throw error;
  }
});

export const RESTORE_PHRASE = 'RESTORE';

export const restoreBackup = wrap(async (req, res) => {
  const actor = actorOf(req);
  const { confirmation, password } = req.body || {};
  let target;
  try {
    target = await backups.getBackupDetail(req.params.id);
    if (confirmation !== RESTORE_PHRASE) {
      throw new BackupError(`Type ${RESTORE_PHRASE} exactly to confirm the restore.`, 400, 'CONFIRMATION_REQUIRED');
    }
    await verifyActorPassword(req.user, password);
    // Deleting bucket files that are not in the backup is opt-in and must be an explicit `true`.
    const backup = await backups.startRestore({
      id: req.params.id,
      actor,
      deleteExtraDocuments: req.body?.deleteExtraDocuments === true,
    });
    res.status(202).json({
      success: true,
      message: 'Restore started. A safety backup of the current data is taken first.',
      backup,
    });
  } catch (error) {
    await recordBackupAudit({
      backup: target || { id: req.params.id },
      action: 'restored',
      actor,
      result: 'failure',
      details: { reason: error.code === 'PASSWORD_INCORRECT' || error.code === 'PASSWORD_LOCKED' ? 'password check failed' : describeFailure(error) },
    });
    throw error;
  }
});

export const deleteBackup = wrap(async (req, res) => {
  await backups.deleteBackup({ id: req.params.id, actor: actorOf(req) });
  res.json({ success: true, message: 'Backup deleted.' });
});

// ---- download ---------------------------------------------------------------

export const createDownloadLink = wrap(async (req, res) => {
  const actor = actorOf(req);
  try {
    await backups.getBackupDetail(req.params.id);
    await verifyActorPassword(req.user, req.body?.password);
    const backup = await backups.assertDownloadable(req.params.id);
    const { token, expiresInSec } = issueDownloadToken({ userId: actor.id, backupId: backup.id });
    res.json({
      success: true,
      // Relative to the API base URL. Fetch it WITH the Authorization header: the link alone is not enough.
      path: `/admin/backups/downloads/${token}`,
      fileName: backup.file_name,
      expiresInSec,
    });
  } catch (error) {
    await recordBackupAudit({
      backup: { id: req.params.id },
      action: 'downloaded',
      actor,
      result: 'failure',
      details: { reason: error.code === 'PASSWORD_INCORRECT' || error.code === 'PASSWORD_LOCKED' ? 'password check failed' : describeFailure(error) },
    });
    throw error;
  }
});

export const downloadFile = async (req, res, next) => {
  const actor = actorOf(req);
  let opened;
  try {
    const entry = consumeDownloadToken(req.params.token, { userId: actor.id });
    opened = await backups.openDownload(entry.backupId);
  } catch (error) {
    if (!(error instanceof BackupError)) console.error('[backup] download failed:', redact(error?.message));
    await recordBackupAudit({
      backup: null,
      action: 'downloaded',
      actor,
      result: 'failure',
      details: { reason: describeFailure(error) },
    });
    return next(error);
  }

  const { row, stream, size } = opened;
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${row.file_name}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(row.checksum_sha256 ? { 'X-Backup-SHA256': row.checksum_sha256 } : {}),
    ...(size ? { 'Content-Length': String(size) } : {}),
  });

  try {
    await pipeline(stream, res);
    await recordBackupAudit({
      backup: row,
      action: 'downloaded',
      actor,
      details: { sizeBytes: size, checksum: row.checksum_sha256 },
    });
  } catch (error) {
    console.error('[backup] download stream interrupted:', redact(error?.message));
    await recordBackupAudit({
      backup: row,
      action: 'downloaded',
      actor,
      result: 'failure',
      details: { reason: 'transfer interrupted' },
    });
    if (!res.headersSent) next(error);
  }
};

// ---- activity log -----------------------------------------------------------

function auditFilters(query) {
  return {
    action: oneOf(query.action, AUDIT_ACTIONS),
    result: oneOf(query.result, ['success', 'failure']),
    search: query.search ? String(query.search).trim().slice(0, 100) : undefined,
    ...dateRange(query),
  };
}

export const getAuditLog = wrap(async (req, res) => {
  const page = positiveInt(req.query.page, 1, 1_000_000);
  const limit = positiveInt(req.query.limit, 25, 100);
  const { rows, total } = await listAudit({ page, limit, ...auditFilters(req.query) });
  res.json({ success: true, logs: rows, pagination: pagination(page, limit, total) });
});

export const exportAudit = wrap(async (req, res) => {
  const csv = await exportAuditCsv(auditFilters(req.query));
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="backup-activity-${new Date().toISOString().slice(0, 10)}.csv"`,
    'Cache-Control': 'no-store',
  });
  res.send(csv);
});
