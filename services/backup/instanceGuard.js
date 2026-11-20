import cluster from 'node:cluster';
import { BackupError } from './errors.js';

// The backup feature keeps three things in the memory of ONE process: the "one job
// at a time" flag, the maintenance-mode switch during a restore, and the download
// tokens. With several backend instances (PM2 cluster mode, instances > 1, or a
// second server behind a load balancer) another instance would not see them:
// it could start a second job, keep serving customers during a restore, or reject
// a download link issued by a sibling. So the feature is meant for a single
// instance (PM2 fork mode, instances: 1 — see ecosystem.config.cjs).

/** Reads the PM2 / Node cluster environment. Pure, so it can be tested. */
export function detectMultiInstance({ env = process.env, isWorker = cluster.isWorker } = {}) {
  const instances = String(env.instances ?? '').trim().toLowerCase();
  const index = Number.parseInt(env.NODE_APP_INSTANCE ?? '', 10);

  if (isWorker) return { multi: true, reason: 'running as a Node cluster worker' };
  if (env.exec_mode === 'cluster_mode' && instances && instances !== '1') {
    return { multi: true, reason: `PM2 cluster mode with instances: ${instances}` };
  }
  if (Number.isFinite(index) && index > 0) {
    return { multi: true, reason: `PM2 instance #${index} (more than one instance is running)` };
  }
  return { multi: false, reason: '' };
}

const allowed = () => String(process.env.BACKUP_ALLOW_MULTI_INSTANCE || '').toLowerCase() === 'true';

/** Status for the dashboard and the startup log. */
export function instanceStatus() {
  const { multi, reason } = detectMultiInstance();
  return { ok: !multi || allowed(), multi, reason, overridden: multi && allowed() };
}

/** Logs a clear warning at startup when the backend is not running as a single instance. */
export function warnIfMultiInstance(log = console.warn) {
  const { multi, reason, overridden } = instanceStatus();
  if (!multi) return false;
  log(
    `[backup] WARNING: ${reason}. The backup feature needs a SINGLE backend instance (PM2 fork mode, instances: 1): ` +
      'its job lock, restore maintenance mode and download links live in process memory. ' +
      (overridden
        ? 'BACKUP_ALLOW_MULTI_INSTANCE=true is set, so backups are allowed anyway, at your own risk.'
        : 'Backup, verify, test restore and restore are refused until the backend runs as one instance.')
  );
  return true;
}

/** Refuses an operation when more than one instance is running. */
export function assertSingleInstance() {
  const { ok, reason } = instanceStatus();
  if (ok) return;
  throw new BackupError(
    `Backups cannot run while the backend has more than one instance (${reason}). Run the backend as a single instance (PM2 fork mode, instances: 1) and try again.`,
    503,
    'MULTI_INSTANCE'
  );
}
