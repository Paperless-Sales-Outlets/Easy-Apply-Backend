import { pool } from '../../config/db.js';
import { BackupError } from './errors.js';

// One backup / verify / test-restore / restore at a time.
//
// The in-process flag is what actually guarantees this for the single PM2
// process the portal runs in. A PostgreSQL advisory lock is taken as well, so a
// second server instance pointed at the same database is also kept out. (With a
// transaction-mode pooler such as Supabase port 6543 the advisory lock is not
// reliable; the in-process flag still holds.)

const LOCK_KEY = 7_340_211; // arbitrary application-wide constant

let current = null;

const busy = (job) =>
  new BackupError(
    job?.op
      ? `Another operation (${job.op}) is already running. Wait for it to finish, then try again.`
      : 'Another backup or restore is already running. Wait for it to finish, then try again.',
    409,
    'JOB_IN_PROGRESS'
  );

/** The job holding the lock, or null: { op, backupId, startedAt }. */
export const getActiveJob = () => (current && !current.pending ? { ...current } : null);

/**
 * Takes the lock or throws 409. Returns an async `release()` that must be
 * called in a `finally`.
 */
export async function acquireJobLock({ op, backupId = null }) {
  if (current) throw busy(current);
  current = { op, backupId, startedAt: new Date().toISOString(), pending: true };

  let client = null;
  try {
    try {
      client = await pool.connect();
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
      if (!rows[0].ok) {
        client.release();
        client = null;
        throw busy(null);
      }
    } catch (error) {
      if (error instanceof BackupError) throw error;
      // Advisory lock unavailable (e.g. pooler): rely on the in-process flag.
      if (client) {
        client.release(true);
        client = null;
      }
    }
  } catch (error) {
    current = null;
    throw error;
  }

  current = { op, backupId, startedAt: current.startedAt };
  let released = false;
  return async function release() {
    if (released) return;
    released = true;
    try {
      if (client) {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
        client.release();
      }
    } finally {
      current = null;
    }
  };
}

/** Test helper. */
export const resetLockForTests = () => {
  current = null;
};
