import pg from 'pg';
import { getDbConnection } from './config.js';
import { BackupError, redact } from './errors.js';
import { assertSingleInstance } from './instanceGuard.js';

// One backup / verify / test-restore / restore at a time.
//
// The in-process flag is what guarantees this for the single backend process the
// feature requires (see instanceGuard.js). A PostgreSQL advisory lock is taken as
// well, so a stray second process pointed at the same database is also kept out.
//
// The advisory lock is held on its OWN dedicated connection (the backup connection:
// direct or session pooler), never on the app's shared pool. Session-level advisory
// locks belong to one server connection: on a pooled connection (Supabase port 6543)
// the lock stays behind on a connection other clients reuse, the unlock runs
// somewhere else, and every later backup is refused as "already running".
// A dedicated connection is closed when the job ends, which always releases the lock.

// Bumped from the original value: with the old key, locks leaked through the pooled
// connection could still be held by a database server connection somewhere.
const LOCK_KEY = 7_340_212;

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

/** Opens the dedicated connection and takes the advisory lock. Returns the client, or null if no connection could be made. */
async function takeAdvisoryLock() {
  let client = null;
  try {
    const c = getDbConnection();
    client = new pg.Client({
      host: c.host,
      port: Number(c.port),
      user: c.user,
      password: c.password,
      database: c.database,
      ssl: c.ssl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 10000,
    });
    client.on('error', () => {}); // a dropped connection must not crash the process
    await client.connect();
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!rows[0].ok) {
      await client.end().catch(() => {});
      throw busy(null);
    }
    return client;
  } catch (error) {
    if (error instanceof BackupError && error.code === 'JOB_IN_PROGRESS') throw error;
    // The advisory lock is an extra safety net: if it cannot be taken (no connection, pooler quirks),
    // the in-process flag still guarantees one job at a time.
    console.warn(`[backup] advisory lock unavailable, relying on the in-process lock: ${redact(error?.message)}`);
    if (client) await client.end().catch(() => {});
    return null;
  }
}

/**
 * Takes the lock or throws 409. Returns an async `release()` that must be
 * called in a `finally`.
 */
export async function acquireJobLock({ op, backupId = null }) {
  assertSingleInstance(); // refuse when the backend runs as several instances
  if (current) throw busy(current);
  current = { op, backupId, startedAt: new Date().toISOString(), pending: true };

  let client = null;
  try {
    client = await takeAdvisoryLock();
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
      // Ending the session releases the advisory lock, whatever happened.
      if (client) await client.end().catch(() => {});
    } finally {
      current = null;
    }
  };
}

/** Test helper. */
export const resetLockForTests = () => {
  current = null;
};
