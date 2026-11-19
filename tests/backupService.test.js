import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// -----------------------------------------------------------------------------
// Backup / verify / test restore / restore / delete / 30-backup limit, run
// against a REAL PostgreSQL with pg_dump / pg_restore replaced by fakes.
//
// These tests create tables, insert rows and CREATE / DROP DATABASE, so they
// only run when BACKUP_TEST_DATABASE_URL points at a DISPOSABLE LOCAL database,
// e.g.   BACKUP_TEST_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres
// They refuse to run against any non-local host (never your real database).
// -----------------------------------------------------------------------------

const TEST_URL = process.env.BACKUP_TEST_DATABASE_URL;
const skipReason = TEST_URL ? false : 'set BACKUP_TEST_DATABASE_URL to a disposable local PostgreSQL to run these tests';

if (TEST_URL) {
  const { hostname } = new URL(TEST_URL);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) {
    throw new Error(`Refusing to run backup tests against non-local host "${hostname}".`);
  }
  process.env.DATABASE_URL = TEST_URL;
  process.env.DATABASE_SSL = 'false';
}

const mod = TEST_URL
  ? {
      db: await import('../config/db.js'),
      service: await import('../services/backup/backupService.js'),
      repo: await import('../services/backup/backupRepository.js'),
      audit: await import('../services/backup/auditLog.js'),
      lock: await import('../services/backup/lock.js'),
      maintenance: await import('../services/backup/maintenance.js'),
      storage: await import('../services/backup/storage/index.js'),
      local: await import('../services/backup/storage/LocalStorageAdapter.js'),
      cmd: await import('../services/backup/commands.js'),
      config: await import('../services/backup/config.js'),
      errors: await import('../services/backup/errors.js'),
      crypto: await import('../services/backup/crypto.js'),
      reauth: await import('../services/backup/reauth.js'),
      bcrypt: (await import('bcryptjs')).default,
    }
  : {};

describe('Backup service', { skip: skipReason }, () => {
  const { service, repo, audit, lock, maintenance, storage, local, cmd, config, errors } = mod;
  const { commands } = cmd || {};
  let pool;
  let root;
  let adapter;
  let uploadsDir;
  const original = {};
  const envSaved = {};

  const actor = { id: '11111111-1111-4111-8111-111111111111', name: 'Super Admin One', ip: '10.0.0.5' };

  // ---- fake pg tools ------------------------------------------------------
  const TOC = [
    '; fake archive',
    '1; 1259 1 TABLE public users postgres',
    '2; 1259 2 TABLE public applications postgres',
    '3; 0 1 TABLE DATA public users postgres',
  ].join('\n');
  let dumpCalls;
  let failDumpAt;
  let restoreCalls;
  let failLiveRestore;
  let failTempRestore;

  const fakeCommands = {
    toolVersion: async () => 'fake 1.0',
    async pgDump(file) {
      dumpCalls += 1;
      if (failDumpAt === dumpCalls) throw new errors.BackupError('The database dump failed. See the server log for details.', 500, 'COMMAND_FAILED');
      fs.writeFileSync(file, Buffer.concat([Buffer.from('PGDMP'), crypto.randomBytes(4096)]));
    },
    pgRestoreList: async () => TOC,
    async pgRestore(file, database, options = {}) {
      const live = config.getDbConnection().database;
      restoreCalls.push({ database, options, maintenance: maintenance.getMaintenance(), isLive: database === live });
      if (database === live) {
        if (failLiveRestore) throw new errors.BackupError('The database restore failed. See the server log for details.', 500, 'COMMAND_FAILED');
        return;
      }
      if (failTempRestore) throw new errors.BackupError('The database restore failed. See the server log for details.', 500, 'COMMAND_FAILED');
      // Temporary test database: create the tables the archive claims to hold.
      const pg = (await import('pg')).default;
      const c = config.getDbConnection();
      const client = new pg.Client({ host: c.host, port: Number(c.port), user: c.user, password: c.password, database });
      await client.connect();
      try {
        await client.query('CREATE TABLE users (id int)');
        await client.query('INSERT INTO users SELECT generate_series(1, 3)');
        await client.query('CREATE TABLE applications (id int)');
        await client.query('INSERT INTO applications SELECT generate_series(1, 2)');
      } finally {
        await client.end();
      }
    },
  };

  // ---- helpers ------------------------------------------------------------
  const waitFor = async (predicate, label, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const value = await predicate();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  const waitIdle = () => waitFor(() => lock.getActiveJob() === null, 'the job lock to be released');
  const settled = async (id) => {
    const row = await waitFor(async () => {
      const r = await repo.getBackup(id);
      return r && r.status !== 'in_progress' ? r : null;
    }, `backup ${id}`);
    await waitIdle();
    return row;
  };
  const waitResult = async (id, column) => {
    const row = await waitFor(async () => {
      const r = await repo.getBackup(id);
      return r?.[column] && r[column].status !== 'running' ? r : null;
    }, `${column} of ${id}`);
    await waitIdle();
    return row[column];
  };
  const makeBackup = async (type = 'database', note = 'Before release v2.3') => {
    const started = await service.startBackup({ type, note, actor });
    return settled(started.id);
  };
  const auditActions = async (backupId) =>
    (await pool.query('SELECT action, result FROM backup_audit_logs WHERE backup_id = $1 ORDER BY created_at', [backupId])).rows;

  before(async () => {
    pool = mod.db.pool;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-backup-svc-'));
    uploadsDir = path.join(root, 'uploads');
    fs.mkdirSync(uploadsDir);
    fs.writeFileSync(path.join(uploadsDir, 'nic-front.png'), 'fake image bytes');

    for (const key of ['BACKUP_ENCRYPTION_KEY', 'BACKUP_TMP_DIR', 'BACKUP_UPLOADS_PATH', 'BACKUP_MAX_COUNT', 'BACKUP_WARNING_DAYS']) envSaved[key] = process.env[key];
    process.env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.BACKUP_TMP_DIR = path.join(root, 'tmp');
    process.env.BACKUP_UPLOADS_PATH = uploadsDir;
    process.env.BACKUP_MAX_COUNT = '30';
    process.env.BACKUP_WARNING_DAYS = '7';

    // Schema: the migration under test, plus a minimal users table for the re-authentication tests.
    await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).catch(() =>
      pool.query(`CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid AS 'SELECT gen_random_uuid()' LANGUAGE sql`)
    );
    await pool.query(fs.readFileSync(new URL('../db/migrations/2026-11-19-backups.sql', import.meta.url), 'utf8'));
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name VARCHAR(255), email VARCHAR(255) UNIQUE, phone VARCHAR(50), nic VARCHAR(50),
      role VARCHAR(50), employee_number VARCHAR(50), permissions TEXT[] DEFAULT '{}', is_active BOOLEAN DEFAULT TRUE,
      password_hash VARCHAR(255), created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);

    adapter = new local.LocalStorageAdapter({ rootDir: path.join(root, 'store') });
    storage.setStorageAdapterForTests(adapter);
    for (const name of Object.keys(fakeCommands)) original[name] = commands[name];
    Object.assign(commands, fakeCommands);
  });

  after(async () => {
    Object.assign(commands, original);
    storage.setStorageAdapterForTests(null);
    for (const [key, value] of Object.entries(envSaved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await pool.query('TRUNCATE backups, backup_audit_logs');
    await pool.end();
    fs.rmSync(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await waitIdle();
    await pool.query('TRUNCATE backups, backup_audit_logs');
    fs.rmSync(path.join(root, 'store'), { recursive: true, force: true });
    dumpCalls = 0;
    failDumpAt = null;
    restoreCalls = [];
    failLiveRestore = false;
    failTempRestore = false;
    process.env.BACKUP_MAX_COUNT = '30';
    maintenance.leaveMaintenance();
  });

  // ---- backup ---------------------------------------------------------------

  describe('create backup', () => {
    test('returns at once with "in progress", then finishes with size, checksum, duration and an audit entry', async () => {
      const started = await service.startBackup({ type: 'database', note: '  Before release v2.3 ', actor });
      assert.equal(started.status, 'in_progress');
      assert.equal(started.note, 'Before release v2.3');
      assert.equal(started.createdByName, 'Super Admin One');

      const row = await settled(started.id);
      assert.equal(row.status, 'success');
      assert.match(row.checksum_sha256, /^[0-9a-f]{64}$/);
      assert.ok(Number(row.size_bytes) > 0);
      assert.ok(Number(row.duration_ms) >= 0);
      assert.equal(row.storage_backend, 'local');
      assert.ok(row.storage_path.endsWith(row.file_name));
      assert.ok(row.file_name.endsWith('.db.sltbak'));

      // The stored file is encrypted and matches the recorded checksum.
      const stored = fs.readFileSync(row.storage_path);
      assert.equal(stored.subarray(0, 4).toString(), 'SLTB');
      assert.ok(!stored.includes('PGDMP'), 'plaintext dump must not be readable in the stored file');
      assert.equal(await mod.crypto.sha256File(row.storage_path), row.checksum_sha256);

      assert.deepEqual(await auditActions(row.id), [{ action: 'created', result: 'success' }]);
      const [entry] = (await audit.listAudit({})).rows;
      assert.equal(entry.actorName, 'Super Admin One');
      assert.equal(entry.ipAddress, '10.0.0.5');
    });

    test('"Database + uploaded files" also archives the uploads folder', async () => {
      const row = await makeBackup('database_files', 'With files');
      assert.equal(row.status, 'success');
      assert.ok(row.file_name.endsWith('.dbfiles.sltbak'));

      const plain = path.join(root, 'check.tar');
      const out = path.join(root, 'check');
      fs.mkdirSync(out, { recursive: true });
      await mod.crypto.decryptFile(row.storage_path, plain);
      await commands.tarExtract(plain, out);
      assert.ok(fs.existsSync(path.join(out, 'database.dump')));
      assert.ok(fs.existsSync(path.join(out, 'uploads.tgz')));
      assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')).files.included, true);
    });

    test('a plain database backup does not include uploads', async () => {
      const row = await makeBackup('database');
      const plain = path.join(root, 'check2.tar');
      const out = path.join(root, 'check2');
      fs.mkdirSync(out, { recursive: true });
      await mod.crypto.decryptFile(row.storage_path, plain);
      await commands.tarExtract(plain, out);
      assert.ok(!fs.existsSync(path.join(out, 'uploads.tgz')));
    });

    test('requires a valid type and a note', async () => {
      await assert.rejects(service.startBackup({ type: 'everything', note: 'x'.repeat(10), actor }), (e) => e.code === 'INVALID_TYPE');
      await assert.rejects(service.startBackup({ type: 'database', note: '  ', actor }), (e) => e.code === 'NOTE_REQUIRED');
      await assert.rejects(service.startBackup({ type: 'database', note: 'x'.repeat(501), actor }), (e) => e.code === 'NOTE_TOO_LONG');
      assert.equal((await pool.query('SELECT COUNT(*)::int n FROM backups')).rows[0].n, 0);
    });

    test('a failed dump is recorded as failed, leaves no file, and shows a friendly message', async () => {
      failDumpAt = 1;
      const started = await service.startBackup({ type: 'database', note: 'Will fail', actor });
      const row = await settled(started.id);
      assert.equal(row.status, 'failed');
      assert.match(row.error_message, /Failed while dumping database/);
      assert.equal(await adapter.exists(`${new Date(row.started_at).getUTCFullYear()}/${row.file_name}`), false);
      assert.deepEqual(await auditActions(row.id), [{ action: 'failed', result: 'failure' }]);
      // The temp working folder is cleaned up.
      assert.deepEqual(fs.readdirSync(process.env.BACKUP_TMP_DIR), []);
    });

    test('refuses to start without an encryption key', async () => {
      const key = process.env.BACKUP_ENCRYPTION_KEY;
      delete process.env.BACKUP_ENCRYPTION_KEY;
      try {
        await assert.rejects(service.startBackup({ type: 'database', note: 'No key', actor }), (e) => e.code === 'ENCRYPTION_NOT_CONFIGURED');
      } finally {
        process.env.BACKUP_ENCRYPTION_KEY = key;
      }
      assert.equal((await pool.query('SELECT COUNT(*)::int n FROM backups')).rows[0].n, 0);
    });

    test('only one backup can run at a time', async () => {
      const release = await lock.acquireJobLock({ op: 'backup' });
      try {
        await assert.rejects(service.startBackup({ type: 'database', note: 'Second one', actor }), (e) => e.code === 'JOB_IN_PROGRESS' && e.statusCode === 409);
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM backups')).rows[0].n, 0);
      } finally {
        await release();
      }
      const summary = await service.getSummary();
      assert.equal(summary.activeJob, null);
    });
  });

  // ---- 30-backup limit ------------------------------------------------------

  describe('maximum number of backups', () => {
    test('at the limit, a new backup is refused and nothing is deleted', async () => {
      process.env.BACKUP_MAX_COUNT = '2';
      const first = await makeBackup('database', 'one!!');
      const second = await makeBackup('database', 'two!!');

      await assert.rejects(
        service.startBackup({ type: 'database', note: 'three!', actor }),
        (e) => e.code === 'BACKUP_LIMIT_REACHED' && e.statusCode === 409 && /Delete old backups/.test(e.message)
      );
      const rows = (await pool.query('SELECT id FROM backups')).rows.map((r) => r.id).sort();
      assert.deepEqual(rows, [first.id, second.id].sort());
      assert.equal(fs.existsSync(first.storage_path), true);
      assert.equal(fs.existsSync(second.storage_path), true);

      const summary = await service.getSummary();
      assert.equal(summary.count, 2);
      assert.equal(summary.maxBackups, 2);
      assert.equal(summary.limitReached, true);
    });

    test('failed backups do not count; deleting one makes room again', async () => {
      process.env.BACKUP_MAX_COUNT = '2';
      failDumpAt = 1;
      await settled((await service.startBackup({ type: 'database', note: 'fails', actor })).id);
      const a = await makeBackup('database', 'first one');
      const b = await makeBackup('database', 'second one');
      assert.equal((await service.getSummary()).count, 2);

      await assert.rejects(service.startBackup({ type: 'database', note: 'third one', actor }), (e) => e.code === 'BACKUP_LIMIT_REACHED');
      await service.deleteBackup({ id: a.id, actor });
      const c = await makeBackup('database', 'third one');
      assert.equal(c.status, 'success');
      assert.ok(b.id);
    });

    test('defaults to 30', async () => {
      delete process.env.BACKUP_MAX_COUNT;
      assert.equal(config.getConfig().maxBackups, 30);
    });
  });

  // ---- verify ---------------------------------------------------------------

  describe('verify integrity', () => {
    test('passes for an intact backup (checksum, decryption, pg_restore --list)', async () => {
      const row = await makeBackup();
      await service.startVerify({ id: row.id, actor });
      const result = await waitResult(row.id, 'verify_result');
      assert.equal(result.status, 'passed');
      assert.ok(result.checks.some((c) => /SHA-256/.test(c.name)));
      assert.ok(result.checks.some((c) => /pg_restore --list/.test(c.name)));
      assert.deepEqual(await auditActions(row.id), [
        { action: 'created', result: 'success' },
        { action: 'verified', result: 'success' },
      ]);
    });

    test('fails when the stored file has been altered', async () => {
      const row = await makeBackup();
      const bytes = fs.readFileSync(row.storage_path);
      bytes[200] ^= 0x01;
      fs.writeFileSync(row.storage_path, bytes);

      await service.startVerify({ id: row.id, actor });
      const result = await waitResult(row.id, 'verify_result');
      assert.equal(result.status, 'failed');
      assert.match(result.error, /checksum does not match/i);
      assert.equal((await auditActions(row.id)).at(-1).result, 'failure');
    });

    test('fails when the file is missing from storage', async () => {
      const row = await makeBackup();
      fs.rmSync(row.storage_path);
      await service.startVerify({ id: row.id, actor });
      const result = await waitResult(row.id, 'verify_result');
      assert.equal(result.status, 'failed');
      assert.match(result.error, /missing from storage/i);
    });

    test('cannot verify a failed backup', async () => {
      failDumpAt = 1;
      const row = await settled((await service.startBackup({ type: 'database', note: 'fails', actor })).id);
      await assert.rejects(service.startVerify({ id: row.id, actor }), (e) => e.code === 'BACKUP_NOT_READY');
    });
  });

  // ---- test restore ---------------------------------------------------------

  describe('test restore', () => {
    const tempDatabases = async () =>
      (await pool.query(`SELECT datname FROM pg_database WHERE datname LIKE 'slt_backup_test_%'`)).rows;

    test('restores into a temporary database, reports row counts, then drops it', async () => {
      const row = await makeBackup();
      await service.startTestRestore({ id: row.id, actor });
      const result = await waitResult(row.id, 'test_restore_result');

      assert.equal(result.status, 'passed', JSON.stringify(result));
      assert.deepEqual(
        result.tables.sort((x, y) => x.name.localeCompare(y.name)),
        [{ name: 'applications', rows: 2 }, { name: 'users', rows: 3 }]
      );
      assert.equal(result.totalRows, 5);
      assert.equal(result.tempDatabaseDropped, true);
      assert.deepEqual(await tempDatabases(), []);

      // Never touches the live database.
      assert.equal(restoreCalls.length, 1);
      assert.equal(restoreCalls[0].isLive, false);
      assert.equal(restoreCalls[0].options.replace, false);
      assert.equal(maintenance.getMaintenance(), null);
      assert.equal((await auditActions(row.id)).at(-1).action, 'test_restored');
    });

    test('a failing restore is reported and the temporary database is still dropped', async () => {
      const row = await makeBackup();
      failTempRestore = true;
      await service.startTestRestore({ id: row.id, actor });
      const result = await waitResult(row.id, 'test_restore_result');
      assert.equal(result.status, 'failed');
      assert.match(result.error, /restore failed/i);
      assert.equal(result.tempDatabaseDropped, true);
      assert.deepEqual(await tempDatabases(), []);
      assert.deepEqual((await auditActions(row.id)).at(-1), { action: 'test_restored', result: 'failure' });
    });

    test('fails when tables are missing after the restore', async () => {
      const row = await makeBackup();
      const savedRestore = commands.pgRestore;
      commands.pgRestore = async (file, database) => {
        restoreCalls.push({ database });
        const pg = (await import('pg')).default;
        const c = config.getDbConnection();
        const client = new pg.Client({ host: c.host, port: Number(c.port), user: c.user, password: c.password, database });
        await client.connect();
        await client.query('CREATE TABLE users (id int)'); // "applications" is missing
        await client.end();
      };
      try {
        await service.startTestRestore({ id: row.id, actor });
        const result = await waitResult(row.id, 'test_restore_result');
        assert.equal(result.status, 'failed');
        assert.match(result.error, /missing after restore: applications/i);
        assert.deepEqual(await tempDatabases(), []);
      } finally {
        commands.pgRestore = savedRestore;
      }
    });
  });

  // ---- restore --------------------------------------------------------------

  describe('restore', () => {
    test('takes an "Auto pre-restore backup" first, then replaces the data in maintenance mode', async () => {
      const row = await makeBackup('database', 'Good state');
      await service.startRestore({ id: row.id, actor });
      const result = await waitResult(row.id, 'restore_result');

      assert.equal(result.status, 'success', JSON.stringify(result));
      const pre = await repo.getBackup(result.preRestoreBackupId);
      assert.equal(pre.purpose, 'pre_restore');
      assert.equal(pre.note, 'Auto pre-restore backup');
      assert.equal(pre.status, 'success');
      assert.equal(pre.created_by_name, 'Super Admin One');
      assert.equal(dumpCalls, 2, 'one dump for the original backup, one for the safety backup');

      const live = restoreCalls.filter((c) => c.isLive);
      assert.equal(live.length, 1);
      assert.equal(live[0].options.replace, true);
      assert.ok(live[0].maintenance, 'the API must be in maintenance mode while data is replaced');
      assert.equal(maintenance.getMaintenance(), null, 'maintenance mode ends afterwards');

      assert.deepEqual(await auditActions(row.id), [
        { action: 'created', result: 'success' },
        { action: 'restored', result: 'success' },
      ]);
      assert.deepEqual(await auditActions(pre.id), [{ action: 'created', result: 'success' }]);
    });

    test('if the safety backup fails, nothing is restored', async () => {
      const row = await makeBackup('database', 'Good state');
      failDumpAt = dumpCalls + 1; // the next dump is the safety backup
      await service.startRestore({ id: row.id, actor });
      const result = await waitResult(row.id, 'restore_result');

      assert.equal(result.status, 'failed');
      assert.match(result.error, /safety backup .* failed/i);
      assert.match(result.error, /not changed/i);
      assert.equal(restoreCalls.filter((c) => c.isLive).length, 0);
      assert.equal(maintenance.getMaintenance(), null);
      assert.deepEqual((await auditActions(row.id)).at(-1), { action: 'restored', result: 'failure' });
    });

    test('a failed restore ends maintenance mode and says the data was not changed', async () => {
      const row = await makeBackup('database', 'Good state');
      failLiveRestore = true;
      await service.startRestore({ id: row.id, actor });
      const result = await waitResult(row.id, 'restore_result');
      assert.equal(result.status, 'failed');
      assert.match(result.error, /live data was not changed/i);
      assert.equal(maintenance.getMaintenance(), null);
      assert.ok(result.preRestoreBackupId, 'the safety backup is kept');
    });

    test('is refused when no slot is free for the safety backup, without deleting anything', async () => {
      process.env.BACKUP_MAX_COUNT = '1';
      const row = await makeBackup('database', 'Only one');
      await assert.rejects(service.startRestore({ id: row.id, actor }), (e) => e.code === 'BACKUP_LIMIT_REACHED' && /safety backup/.test(e.message));
      assert.equal((await pool.query('SELECT COUNT(*)::int n FROM backups')).rows[0].n, 1);
      assert.equal(restoreCalls.length, 0);
      assert.equal(lock.getActiveJob(), null, 'the lock is released after a refusal');
    });

    test('cannot restore a failed backup', async () => {
      failDumpAt = 1;
      const row = await settled((await service.startBackup({ type: 'database', note: 'fails', actor })).id);
      await assert.rejects(service.startRestore({ id: row.id, actor }), (e) => e.code === 'BACKUP_NOT_READY');
    });

    test('maintenance gate answers 503 to other requests but lets the backup API and health check through', () => {
      const calls = [];
      const res = {
        set() {},
        status(code) { calls.push(code); return this; },
        json() { return this; },
      };
      maintenance.enterMaintenance();
      try {
        maintenance.maintenanceGate({ originalUrl: '/api/applications', method: 'GET' }, res, () => calls.push('next'));
        maintenance.maintenanceGate({ originalUrl: '/api/admin/backups/summary', method: 'GET' }, res, () => calls.push('next'));
        maintenance.maintenanceGate({ originalUrl: '/api/health', method: 'GET' }, res, () => calls.push('next'));
      } finally {
        maintenance.leaveMaintenance();
      }
      assert.deepEqual(calls, [503, 'next', 'next']);
    });
  });

  // ---- delete ---------------------------------------------------------------

  describe('delete', () => {
    test('the most recent successful backup cannot be deleted', async () => {
      const older = await makeBackup('database', 'older');
      const newest = await makeBackup('database', 'newest');
      await assert.rejects(service.deleteBackup({ id: newest.id, actor }), (e) => e.code === 'LATEST_BACKUP' && e.statusCode === 409);
      assert.equal(fs.existsSync(newest.storage_path), true);
      assert.deepEqual((await auditActions(newest.id)).at(-1), { action: 'deleted', result: 'failure' });

      await service.deleteBackup({ id: older.id, actor });
      assert.equal(await repo.getBackup(older.id), null);
      assert.equal(fs.existsSync(older.storage_path), false, 'file removed from storage');
      assert.deepEqual((await auditActions(older.id)).at(-1), { action: 'deleted', result: 'success' });
      assert.equal((await repo.getBackup(newest.id)).status, 'success');
    });

    test('a single backup is the most recent, so it cannot be deleted', async () => {
      const only = await makeBackup();
      await assert.rejects(service.deleteBackup({ id: only.id, actor }), (e) => e.code === 'LATEST_BACKUP');
    });

    test('a failed backup record can be deleted', async () => {
      await makeBackup('database', 'good');
      failDumpAt = dumpCalls + 1;
      const failed = await settled((await service.startBackup({ type: 'database', note: 'bad', actor })).id);
      await service.deleteBackup({ id: failed.id, actor });
      assert.equal(await repo.getBackup(failed.id), null);
    });

    test('a running backup cannot be deleted', async () => {
      const running = await repo.insertBackup({ fileName: 'x.sltbak', type: 'database', purpose: 'manual', note: 'running', actor, storageBackend: 'local' });
      await assert.rejects(service.deleteBackup({ id: running.id, actor }), (e) => e.code === 'BACKUP_RUNNING');
    });

    test('an unknown backup is a 404', async () => {
      await assert.rejects(service.deleteBackup({ id: '3f2b8c1e-5d4a-4e6b-9a7c-1b2d3e4f5a6b', actor }), (e) => e.statusCode === 404);
    });
  });

  // ---- download -------------------------------------------------------------

  describe('download', () => {
    test('a link can be prepared for a good backup and opens the stored file', async () => {
      const row = await makeBackup();
      const checked = await service.assertDownloadable(row.id);
      assert.equal(checked.id, row.id);
      const opened = await service.openDownload(row.id);
      assert.equal(opened.size, Number(row.size_bytes));
      opened.stream.destroy();
    });

    test('is refused when the file is missing', async () => {
      const row = await makeBackup();
      fs.rmSync(row.storage_path);
      await assert.rejects(service.assertDownloadable(row.id), (e) => e.code === 'FILE_MISSING');
    });
  });

  // ---- re-authentication ------------------------------------------------------

  describe('password re-entry (download / restore)', () => {
    let account;
    before(async () => {
      const hash = await mod.bcrypt.hash('Correct-Horse-9', 4);
      const { rows } = await pool.query(
        `INSERT INTO users (name, email, role, password_hash) VALUES ('Reauth User', 'reauth@test.local', 'Super Admin', $1) RETURNING id`,
        [hash]
      );
      account = { _id: rows[0].id, id: rows[0].id, role: 'Super Admin' };
      await pool.query(`INSERT INTO users (name, email, role) VALUES ('No Password', 'nopw@test.local', 'Super Admin')`);
    });
    after(() => pool.query(`DELETE FROM users WHERE email IN ('reauth@test.local', 'nopw@test.local')`));

    test('accepts the right password', async () => {
      await assert.doesNotReject(mod.reauth.verifyActorPassword(account, 'Correct-Horse-9'));
    });

    test('rejects a wrong or empty password with 403/400 — never 401', async () => {
      await assert.rejects(mod.reauth.verifyActorPassword(account, 'nope'), (e) => e.code === 'PASSWORD_INCORRECT' && e.statusCode === 403);
      await assert.rejects(mod.reauth.verifyActorPassword(account, ''), (e) => e.code === 'PASSWORD_REQUIRED' && e.statusCode === 400);
      await assert.rejects(mod.reauth.verifyActorPassword(account, undefined), (e) => e.statusCode === 400);
      await mod.reauth.verifyActorPassword(account, 'Correct-Horse-9'); // success clears the count
    });

    test('an account without a password cannot confirm', async () => {
      const { rows } = await pool.query(`SELECT id FROM users WHERE email = 'nopw@test.local'`);
      await assert.rejects(mod.reauth.verifyActorPassword({ _id: rows[0].id }, 'anything'), (e) => e.code === 'NO_PASSWORD');
    });

    test('locks after repeated wrong passwords', async () => {
      let last;
      for (let i = 0; i < 6; i += 1) {
        last = await mod.reauth.verifyActorPassword(account, 'wrong').catch((e) => e);
      }
      assert.equal(last.code, 'PASSWORD_LOCKED');
      assert.equal(last.statusCode, 429);
      await assert.rejects(mod.reauth.verifyActorPassword(account, 'Correct-Horse-9'), (e) => e.code === 'PASSWORD_LOCKED');
      const { clearFailures } = await import('../utils/loginThrottle.js');
      clearFailures(`backup-reauth:${account._id}`);
    });
  });

  // ---- dashboard data -------------------------------------------------------

  describe('summary, settings and activity log', () => {
    test('warns when there is no successful backup or the last one is older than the threshold', async () => {
      let summary = await service.getSummary();
      assert.equal(summary.isStale, true);
      assert.equal(summary.lastSuccess, null);

      const row = await makeBackup();
      summary = await service.getSummary();
      assert.equal(summary.isStale, false);
      assert.equal(summary.lastSuccess.createdByName, 'Super Admin One');
      assert.equal(summary.lastStatus, 'success');
      assert.equal(summary.count, 1);
      assert.ok(summary.totalBytes > 0);

      await pool.query(`UPDATE backups SET finished_at = NOW() - INTERVAL '10 days' WHERE id = $1`, [row.id]);
      summary = await service.getSummary();
      assert.equal(summary.isStale, true);
      assert.equal(summary.daysSinceLastSuccess, 10);

      process.env.BACKUP_WARNING_DAYS = '14';
      assert.equal((await service.getSummary()).isStale, false);
      process.env.BACKUP_WARNING_DAYS = '7';
    });

    test('reports the last status as failed after a failed run', async () => {
      await makeBackup();
      failDumpAt = dumpCalls + 1;
      await settled((await service.startBackup({ type: 'database', note: 'bad', actor })).id);
      assert.equal((await service.getSummary()).lastStatus, 'failed');
    });

    test('settings expose the storage backend and location but no secrets', async () => {
      const settings = await service.getSettings();
      assert.equal(settings.storageBackend, 'local');
      assert.equal(settings.maxBackups, 30);
      assert.equal(settings.warningDays, 7);
      assert.equal(settings.encryptionConfigured, true);
      assert.equal(settings.schedule, 'manual');
      const text = JSON.stringify(settings);
      assert.ok(!text.includes(process.env.BACKUP_ENCRYPTION_KEY));
      assert.ok(!text.includes(config.getDbConnection().password) || config.getDbConnection().password === '');
    });

    test('lists newest first with filters and search', async () => {
      const a = await makeBackup('database', 'Before release v2.3');
      const b = await makeBackup('database_files', 'Monthly check');
      failDumpAt = dumpCalls + 1;
      const c = await settled((await service.startBackup({ type: 'database', note: 'Broken run', actor })).id);

      let { rows, total } = await repo.listBackups({});
      assert.equal(total, 3);
      assert.deepEqual(rows.map((r) => r.id), [c.id, b.id, a.id]);

      assert.deepEqual((await repo.listBackups({ status: 'failed' })).rows.map((r) => r.id), [c.id]);
      assert.deepEqual((await repo.listBackups({ type: 'database_files' })).rows.map((r) => r.id), [b.id]);
      assert.deepEqual((await repo.listBackups({ search: 'release' })).rows.map((r) => r.id), [a.id]);
      assert.deepEqual((await repo.listBackups({ search: b.id.slice(0, 8) })).rows.map((r) => r.id), [b.id]);
      assert.equal((await repo.listBackups({ search: '100%' })).total, 0, 'LIKE wildcards are escaped');
      assert.equal((await repo.listBackups({ from: new Date(Date.now() + 86_400_000) })).total, 0);

      ({ rows, total } = await repo.listBackups({ page: 2, limit: 2 }));
      assert.equal(total, 3);
      assert.equal(rows.length, 1);
    });

    test('activity log filters and exports CSV safely', async () => {
      const row = await makeBackup('database', 'x'.repeat(10));
      await audit.recordBackupAudit({ backup: row, action: 'downloaded', actor: { id: actor.id, name: '=HYPERLINK("http://evil")', ip: '10.1.1.1' }, details: { sizeBytes: 5 } });
      await audit.recordBackupAudit({ backup: row, action: 'downloaded', actor, result: 'failure', details: { reason: 'password check failed' } });

      assert.equal((await audit.listAudit({ action: 'downloaded' })).total, 2);
      assert.equal((await audit.listAudit({ result: 'failure' })).total, 1);
      assert.equal((await audit.listAudit({ search: '10.1.1.1' })).total, 1);
      assert.equal((await audit.listAudit({ backupId: row.id })).total, 3);

      const csv = await audit.exportAuditCsv({});
      assert.match(csv.split('\r\n')[0], /Time \(UTC\)/);
      assert.ok(csv.includes(`"'=HYPERLINK`), 'formula-looking cells are neutralised');
      assert.ok(!csv.includes(`,"=HYPERLINK`));
    });

    test('jobs interrupted by a restart are marked failed', async () => {
      const stuck = await repo.insertBackup({ fileName: 's.sltbak', type: 'database', purpose: 'manual', note: 'stuck', actor, storageBackend: 'local' });
      await pool.query(`UPDATE backups SET verify_result = '{"status":"running"}'::jsonb WHERE id = $1`, [stuck.id]);
      await repo.failInterruptedJobs();
      const row = await repo.getBackup(stuck.id);
      assert.equal(row.status, 'failed');
      assert.match(row.error_message, /server restarted/);
      assert.equal(row.verify_result.status, 'failed');
    });

    test('an error message never contains database credentials', () => {
      const { password } = config.getDbConnection();
      const text = errors.redact(`could not connect: postgresql://postgres:${password || 'pw12345'}@host/db`);
      assert.ok(!text.includes(password || 'pw12345'));
    });
  });
});
