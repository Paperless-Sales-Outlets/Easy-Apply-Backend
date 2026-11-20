import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

// -----------------------------------------------------------------------------
// REAL end-to-end tests of the backup pipeline: real pg_dump / pg_restore / tar,
// real encryption, real storage, real HTTP routes and a real PostgreSQL. Nothing
// is faked, except deliberate fault injection where a test says so.
//
// Runs only when BACKUP_TEST_DATABASE_URL points at a disposable LOCAL
// PostgreSQL server (superuser, e.g. from docker-compose.backup-test.yml):
//
//   BACKUP_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres \
//     npm run test:backup:e2e
//
// It creates (and drops) its own database "slt_e2e_<random>" on that server and
// refuses to run against any non-local host. pg_dump / pg_restore must be on the
// PATH, or set PG_DUMP_PATH / PG_RESTORE_PATH (client version >= server version).
// -----------------------------------------------------------------------------

const ADMIN_URL = process.env.BACKUP_TEST_DATABASE_URL;
const PG_DUMP = process.env.PG_DUMP_PATH || 'pg_dump';
const PG_RESTORE = process.env.PG_RESTORE_PATH || 'pg_restore';

const toolsMissing = () => {
  for (const tool of [PG_DUMP, PG_RESTORE, process.env.BACKUP_TAR_PATH || 'tar']) {
    const run = spawnSync(tool, ['--version'], { encoding: 'utf8' });
    if (run.error || run.status !== 0) return `"${tool}" is not available (put the PostgreSQL client tools on PATH or set PG_DUMP_PATH / PG_RESTORE_PATH)`;
  }
  return false;
};

const skipReason = !ADMIN_URL
  ? 'set BACKUP_TEST_DATABASE_URL to a disposable local PostgreSQL to run the real end-to-end tests'
  : toolsMissing();

const DB_NAME = `slt_e2e_${crypto.randomBytes(5).toString('hex')}`;
let root;
let adminClientConfig;

if (!skipReason) {
  const url = new URL(ADMIN_URL);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
    throw new Error(`Refusing to run against non-local host "${url.hostname}".`);
  }
  adminClientConfig = {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '') || 'postgres'),
  };

  root = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-e2e-'));
  const admin = new pg.Client(adminClientConfig);
  await admin.connect();
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();

  const live = new URL(ADMIN_URL);
  live.pathname = `/${DB_NAME}`;
  const setup = new pg.Client({ ...adminClientConfig, database: DB_NAME });
  await setup.connect();
  await setup.query(fs.readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8'));
  await setup.query(fs.readFileSync(new URL('../fixtures/backup-seed.sql', import.meta.url), 'utf8'));
  await setup.end();

  fs.mkdirSync(path.join(root, 'uploads'));
  fs.writeFileSync(path.join(root, 'uploads', 'nic-front.png'), crypto.randomBytes(20000));
  fs.writeFileSync(path.join(root, 'uploads', 'සිංහල-file.txt'), 'unicode name ✓');

  Object.assign(process.env, {
    DATABASE_URL: live.toString(),
    DATABASE_SSL: 'false',
    BACKUP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    BACKUP_LOCAL_PATH: path.join(root, 'store'),
    BACKUP_TMP_DIR: path.join(root, 'tmp'),
    BACKUP_UPLOADS_PATH: path.join(root, 'uploads'),
    BACKUP_MAX_COUNT: '30',
    BACKUP_WARNING_DAYS: '7',
    BACKUP_ADMIN_DATABASE: 'postgres',
    JWT_ACCESS_SECRET: crypto.randomBytes(24).toString('hex'),
    NODE_ENV: 'test',
  });
  for (const key of ['BACKUP_DATABASE_URL', 'BACKUP_TEST_RESTORE_URL', 'BACKUP_STORAGE']) delete process.env[key];

  // The same suite can run against an S3-compatible server (MinIO, rclone serve s3, ...):
  //   BACKUP_TEST_S3_ENDPOINT=http://127.0.0.1:9000 BACKUP_TEST_S3_BUCKET=slt-backup-test
  //   BACKUP_TEST_S3_ACCESS_KEY=... BACKUP_TEST_S3_SECRET_KEY=...
  if (process.env.BACKUP_TEST_S3_ENDPOINT) {
    Object.assign(process.env, {
      BACKUP_STORAGE: 's3',
      BACKUP_S3_ENDPOINT: process.env.BACKUP_TEST_S3_ENDPOINT,
      BACKUP_S3_BUCKET: process.env.BACKUP_TEST_S3_BUCKET,
      BACKUP_S3_ACCESS_KEY: process.env.BACKUP_TEST_S3_ACCESS_KEY,
      BACKUP_S3_SECRET_KEY: process.env.BACKUP_TEST_S3_SECRET_KEY,
      BACKUP_S3_PREFIX: `e2e-${crypto.randomBytes(4).toString('hex')}`,
      BACKUP_S3_FORCE_PATH_STYLE: 'true',
    });
  }
}

const m = skipReason
  ? {}
  : {
      db: await import('../../config/db.js'),
      service: await import('../../services/backup/backupService.js'),
      repo: await import('../../services/backup/backupRepository.js'),
      lock: await import('../../services/backup/lock.js'),
      docs: await import('../../services/backup/documentStorage.js'),
      storage: await import('../../services/backup/storage/index.js'),
      maintenance: await import('../../services/backup/maintenance.js'),
      cmd: await import('../../services/backup/commands.js'),
      config: await import('../../services/backup/config.js'),
      crypto: await import('../../services/backup/crypto.js'),
      router: (await import('../../routes/admin/backupRoutes.js')).default,
      express: (await import('express')).default,
      jwt: (await import('jsonwebtoken')).default,
      bcrypt: (await import('bcryptjs')).default,
    };

describe('Backup pipeline, real end to end', { skip: skipReason }, () => {
  const { service, repo, lock, maintenance, cmd, config } = m;
  const { commands } = cmd || {};
  const PASSWORD = 'Sup3r-Secret-Pass!';
  const actor = { id: '11111111-1111-4111-8111-111111111111', name: 'Super Admin One', ip: '10.0.0.5' };
  let pool;
  let server;
  let base;
  let superToken;
  let adminToken;
  let originalPgRestore;

  // ---- helpers ------------------------------------------------------------
  const waitFor = async (predicate, label, ms = 60000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const value = await predicate();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 50));
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
  const makeBackup = async (type = 'database', note = 'End to end backup') => {
    const started = await service.startBackup({ type, note, actor });
    const row = await settled(started.id);
    assert.equal(row.status, 'success', row.error_message);
    return row;
  };

  // Storage-agnostic access to a stored backup (local folder or S3).
  const adapter = () => m.storage.getStorageAdapter();
  const keyOf = (row) => service.storageKeyFor(row);
  const fetchStored = async (row) => {
    const dest = path.join(root, `fetched-${crypto.randomBytes(4).toString('hex')}`);
    await adapter().getToFile(keyOf(row), dest);
    return dest;
  };

  const BACKUP_TABLES = new Set(['backups', 'backup_audit_logs']);
  const dataTables = async () =>
    (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`))
      .rows.map((r) => r.table_name)
      .filter((name) => !BACKUP_TABLES.has(name));
  /** Order-independent fingerprint of every row of every table (except the backup history tables). */
  const snapshot = async () => {
    const out = {};
    for (const table of await dataTables()) {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n, md5(COALESCE(string_agg(t::text, E'\\n' ORDER BY t::text), '')) AS hash FROM public."${table}" t`
      );
      out[table] = `${rows[0].n}:${rows[0].hash}`;
    }
    return out;
  };
  const stableTempDatabases = async () =>
    (await pool.query(`SELECT datname FROM pg_database WHERE datname LIKE 'slt_backup_test_%'`)).rows;
  const dirTree = (dir) => {
    const out = {};
    for (const name of fs.readdirSync(dir)) out[name] = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex');
    return out;
  };

  before(async () => {
    // Safety net: never run against anything but our own throw-away database.
    pool = m.db.pool;
    const who = (await pool.query('SELECT current_database() AS db, inet_server_addr()::text AS addr')).rows[0];
    assert.equal(who.db, DB_NAME);
    assert.ok(!who.addr || who.addr.startsWith('127.') || who.addr === '::1');
    await m.db.default();

    const hash = await m.bcrypt.hash(PASSWORD, 4);
    const insert = async (email, role) =>
      (await pool.query(`INSERT INTO users (name, email, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`, [`${role} E2E`, email, role, hash])).rows[0].id;
    const superId = await insert('super.e2e@slt.test', 'Super Admin');
    const adminId = await insert('admin.e2e@slt.test', 'Admin');
    superToken = m.jwt.sign({ id: superId, role: 'Super Admin' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
    adminToken = m.jwt.sign({ id: adminId, role: 'Admin' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });

    const app = m.express();
    app.use(m.express.json());
    app.use('/api/admin/backups', m.router);
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, _next) => res.status(res.statusCode >= 400 ? res.statusCode : err.statusCode || 500).json({ message: err.message, code: err.code }));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/admin/backups`;
    originalPgRestore = commands.pgRestore;
  });

  after(async () => {
    commands.pgRestore = originalPgRestore;
    await new Promise((resolve) => server?.close(resolve));
    await pool.end();
    const admin = new pg.Client(adminClientConfig);
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.end();
    fs.rmSync(root, { recursive: true, force: true });
  });

  // ---- backups ----------------------------------------------------------------

  test('seed data is realistic and the tools are real', async () => {
    const counts = (await pool.query(`SELECT (SELECT count(*) FROM applications)::int AS a, (SELECT count(*) FROM customers)::int AS c`)).rows[0];
    assert.deepEqual(counts, { a: 2000, c: 500 });
    assert.match(await commands.toolVersion(config.getConfig().pgDump), /pg_dump \(PostgreSQL\) \d+/);
  });

  test('full database backup produces an encrypted, checksummed file', async () => {
    const row = await makeBackup('database', 'Full database');
    assert.equal(row.backup_type, 'database');
    assert.match(row.checksum_sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number(row.size_bytes) > 1000);
    const fetched = await fetchStored(row);
    const bytes = fs.readFileSync(fetched);
    assert.equal(bytes.subarray(0, 4).toString(), 'SLTB');
    assert.ok(!bytes.includes(Buffer.from('Applicant 1')), 'customer data must not be readable in the stored file');
    assert.equal(await m.crypto.sha256File(fetched), row.checksum_sha256);
    assert.equal(row.storage_backend, process.env.BACKUP_STORAGE || 'local');
    assert.deepEqual((await pool.query(`SELECT action, result FROM backup_audit_logs WHERE backup_id = $1`, [row.id])).rows, [{ action: 'created', result: 'success' }]);
  });

  test('"Database + uploaded files" backup contains the uploads folder', async () => {
    const row = await makeBackup('database_files', 'With files');
    const plain = path.join(root, 'inspect.tar');
    const out = path.join(root, 'inspect');
    fs.mkdirSync(out, { recursive: true });
    await m.crypto.decryptFile(await fetchStored(row), plain);
    await commands.tarExtract(plain, out);
    assert.ok(fs.existsSync(path.join(out, 'database.dump')));
    assert.ok(fs.existsSync(path.join(out, 'uploads.tgz')));
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.equal(manifest.files.included, true);
    // the real pg_restore can list the real dump
    const toc = await commands.pgRestoreList(path.join(out, 'database.dump'));
    assert.match(toc, /TABLE public applications/);
    assert.ok(!/TABLE public backups\b/.test(toc), 'backup-history tables are excluded from the dump');
    assert.ok(!/TABLE public backup_audit_logs\b/.test(toc));
  });

  // ---- verify ---------------------------------------------------------------

  test('verify passes for an intact backup and fails for a tampered one', async () => {
    const good = await makeBackup();
    await service.startVerify({ id: good.id, actor });
    const ok = await waitResult(good.id, 'verify_result');
    assert.equal(ok.status, 'passed', JSON.stringify(ok));
    assert.ok(ok.checks.some((c) => /pg_restore --list/.test(c.name)));

    const bad = await makeBackup();
    const tamperedFile = await fetchStored(bad);
    const bytes = fs.readFileSync(tamperedFile);
    bytes[500] ^= 0x01;
    fs.writeFileSync(tamperedFile, bytes);
    await adapter().put(tamperedFile, keyOf(bad)); // overwrite the stored copy with the altered one
    await service.startVerify({ id: bad.id, actor });
    const failed = await waitResult(bad.id, 'verify_result');
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /checksum/i);
  });

  // ---- test restore -----------------------------------------------------------

  test('test restore restores into a temporary database, reports correct row counts and drops it', async () => {
    const row = await makeBackup();
    const liveCounts = {};
    for (const table of await dataTables()) liveCounts[table] = (await pool.query(`SELECT count(*)::int n FROM public."${table}"`)).rows[0].n;

    await service.startTestRestore({ id: row.id, actor });
    const result = await waitResult(row.id, 'test_restore_result');
    assert.equal(result.status, 'passed', JSON.stringify(result));
    const reported = Object.fromEntries(result.tables.map((t) => [t.name, t.rows]));
    assert.deepEqual(reported, liveCounts, 'restored row counts equal the live row counts');
    assert.equal(reported.applications, 2000);
    assert.equal(result.tempDatabaseDropped, true);
    assert.deepEqual(await stableTempDatabases(), []);
  });

  test('test restore always drops its temporary database, even when the restore fails midway', async () => {
    const row = await makeBackup();
    commands.pgRestore = async (file, database, options) => {
      await originalPgRestore(file, database, options); // a real, completed restore into the temp database...
      throw new Error('simulated failure after the restore ran'); // ...then a failure
    };
    try {
      await service.startTestRestore({ id: row.id, actor });
      const result = await waitResult(row.id, 'test_restore_result');
      assert.equal(result.status, 'failed');
      assert.equal(result.tempDatabaseDropped, true);
      assert.deepEqual(await stableTempDatabases(), []);
      assert.deepEqual(fs.readdirSync(process.env.BACKUP_TMP_DIR), [], 'working files are removed');
    } finally {
      commands.pgRestore = originalPgRestore;
    }
  });

  // ---- full restore -----------------------------------------------------------

  test('restore returns the data to exactly the backed-up state; history and audit tables survive', async () => {
    const before = await snapshot();
    const filesBefore = dirTree(process.env.BACKUP_UPLOADS_PATH);
    const target = await makeBackup('database_files', 'State to restore');

    // Change data in many ways, and the uploads folder.
    await pool.query(`DELETE FROM applications WHERE id IN (SELECT id FROM applications ORDER BY created_at LIMIT 700)`);
    await pool.query(`UPDATE customers SET name = 'CHANGED', kyc_status = 'rejected' WHERE phone LIKE '%1%'`);
    await pool.query(`INSERT INTO products (id, name, category) VALUES ('P9999', 'Brand new package', 'Fibre')`);
    await pool.query(`TRUNCATE audit_logs`);
    assert.notDeepEqual(await snapshot(), before);
    fs.writeFileSync(path.join(process.env.BACKUP_UPLOADS_PATH, 'new-after-backup.txt'), 'should disappear');
    fs.rmSync(path.join(process.env.BACKUP_UPLOADS_PATH, 'nic-front.png'));

    // A later backup and its audit entries must survive the restore.
    const later = await makeBackup('database', 'Made after the state to restore');
    const historyBefore = (await pool.query('SELECT count(*)::int n FROM backups')).rows[0].n;
    const auditBefore = (await pool.query('SELECT count(*)::int n FROM backup_audit_logs')).rows[0].n;

    // Watch the real restore call: maintenance mode must be on during it.
    const seen = [];
    commands.pgRestore = async (file, database, options) => {
      seen.push({ database, replace: options?.replace, maintenance: Boolean(maintenance.getMaintenance()) });
      return originalPgRestore(file, database, options);
    };
    try {
      await service.startRestore({ id: target.id, actor });
      const result = await waitResult(target.id, 'restore_result');
      assert.equal(result.status, 'success', JSON.stringify(result));

      // data matches the backup exactly
      assert.deepEqual(await snapshot(), before);
      assert.equal((await pool.query(`SELECT count(*)::int n FROM products WHERE id = 'P9999'`)).rows[0].n, 0);

      // uploads folder matches the backup; the replaced folder was kept aside
      assert.deepEqual(dirTree(process.env.BACKUP_UPLOADS_PATH), filesBefore);
      const aside = fs.readdirSync(root).filter((n) => n.startsWith('uploads.before-restore-'));
      assert.equal(aside.length, 1);

      // automatic pre-restore backup exists and is a good backup
      const pre = await repo.getBackup(result.preRestoreBackupId);
      assert.equal(pre.purpose, 'pre_restore');
      assert.equal(pre.note, 'Auto pre-restore backup');
      assert.equal(pre.status, 'success');

      // maintenance mode was on during the real restore and is off afterwards
      assert.deepEqual(seen, [{ database: config.getDbConnection().database, replace: true, maintenance: true }]);
      assert.equal(maintenance.getMaintenance(), null);

      // backup history and audit trail were NOT rolled back
      const ids = (await pool.query('SELECT id FROM backups')).rows.map((r) => r.id);
      assert.ok(ids.includes(later.id), 'a backup made after the restored state still exists');
      assert.ok(ids.includes(pre.id));
      assert.equal((await pool.query('SELECT count(*)::int n FROM backups')).rows[0].n, historyBefore + 1); // + pre-restore backup
      assert.ok((await pool.query('SELECT count(*)::int n FROM backup_audit_logs')).rows[0].n > auditBefore);
      assert.deepEqual(
        (await pool.query(`SELECT result FROM backup_audit_logs WHERE backup_id = $1 AND action = 'restored'`, [target.id])).rows,
        [{ result: 'success' }]
      );
    } finally {
      commands.pgRestore = originalPgRestore;
    }
  });

  test('a restore that fails midway leaves the database unchanged and ends maintenance mode', async () => {
    const target = await makeBackup('database', 'Restore will fail');

    // Change data, then add an object that makes the restore's DROP TABLE fail part-way through.
    await pool.query(`UPDATE customers SET name = 'LIVE EDIT' WHERE phone LIKE '%2%'`);
    await pool.query(`DELETE FROM products WHERE id = 'P0001'`);
    await pool.query(`CREATE VIEW public.zz_blocker AS SELECT id, reference_number FROM public.applications`);
    const liveBefore = await snapshot();
    const historyBefore = (await pool.query('SELECT count(*)::int n FROM backups')).rows[0].n;

    try {
      await service.startRestore({ id: target.id, actor });
      const result = await waitResult(target.id, 'restore_result');

      assert.equal(result.status, 'failed');
      assert.match(result.error, /live data was not changed/i);
      assert.deepEqual(await snapshot(), liveBefore, 'single transaction: nothing was changed');
      assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_views WHERE viewname = 'zz_blocker'`)).rows[0].n, 1);
      assert.equal(maintenance.getMaintenance(), null, 'maintenance mode is switched off after a failure');
      assert.ok(result.preRestoreBackupId, 'the safety backup was still taken and is kept');
      assert.equal((await repo.getBackup(result.preRestoreBackupId)).status, 'success');
      assert.equal((await pool.query('SELECT count(*)::int n FROM backups')).rows[0].n, historyBefore + 1);
      assert.deepEqual(
        (await pool.query(`SELECT result FROM backup_audit_logs WHERE backup_id = $1 AND action = 'restored'`, [target.id])).rows,
        [{ result: 'failure' }]
      );
    } finally {
      await pool.query('DROP VIEW IF EXISTS public.zz_blocker');
    }
  });

  // ---- download over HTTP, with the real auth middleware ----------------------

  describe('download link (real routes and JWT auth)', () => {
    const auth = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
    const link = async (id, password = PASSWORD, token = superToken) => {
      const res = await fetch(`${base}/${id}/download-link`, { method: 'POST', headers: auth(token), body: JSON.stringify({ password }) });
      return { res, body: await res.json() };
    };

    test('needs the password, works once with the bearer token, and the file matches its checksum', async () => {
      const row = await makeBackup();
      assert.equal((await link(row.id, 'wrong-password')).res.status, 403);
      const { res, body } = await link(row.id);
      assert.equal(res.status, 200);
      assert.match(body.path, /^\/admin\/backups\/downloads\//);

      const url = `http://127.0.0.1:${server.address().port}/api/${body.path.replace(/^\//, '')}`;
      const first = await fetch(url, { headers: auth(superToken) });
      assert.equal(first.status, 200);
      const bytes = Buffer.from(await first.arrayBuffer());
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.checksum_sha256);
      assert.equal(first.headers.get('x-backup-sha256'), row.checksum_sha256);
      assert.equal(first.headers.get('cache-control'), 'no-store');

      const second = await fetch(url, { headers: auth(superToken) });
      assert.equal(second.status, 410, 'a link works only once');

      const audit = (await pool.query(`SELECT result, ip_address FROM backup_audit_logs WHERE backup_id = $1 AND action = 'downloaded' ORDER BY created_at`, [row.id])).rows;
      assert.deepEqual(audit.map((a) => a.result), ['failure', 'success'], 'the wrong password and the real download are both recorded');
    });

    test('is rejected without a bearer token, for another user, and for a normal Admin', async () => {
      const row = await makeBackup();
      const { body } = await link(row.id);
      const url = `http://127.0.0.1:${server.address().port}/api/${body.path.replace(/^\//, '')}`;
      assert.equal((await fetch(url)).status, 401, 'no bearer token');
      // the unauthenticated attempt must not have burned or leaked the link
      assert.equal((await fetch(`${url}?token=${superToken}`, { headers: auth(superToken) })).status, 400, 'token in the URL is refused');
      assert.equal((await fetch(url, { headers: auth(adminToken) })).status, 403, 'a normal Admin');

      assert.equal((await link(row.id, PASSWORD, adminToken)).res.status, 403);
    });

    test('expires after its lifetime', async () => {
      const row = await makeBackup();
      process.env.BACKUP_DOWNLOAD_TTL_SEC = '1';
      const { body } = await link(row.id);
      process.env.BACKUP_DOWNLOAD_TTL_SEC = '60';
      await new Promise((r) => setTimeout(r, 1500));
      const url = `http://127.0.0.1:${server.address().port}/api/${body.path.replace(/^\//, '')}`;
      assert.equal((await fetch(url, { headers: auth(superToken) })).status, 410);
    });

    test('the default lifetime is 60 seconds', () => {
      delete process.env.BACKUP_DOWNLOAD_TTL_SEC;
      assert.equal(config.getConfig().downloadTtlSec, 60);
    });
  });

  // ---- limits and delete rules --------------------------------------------------

  test('the 30-backup limit and "latest successful backup cannot be deleted", over HTTP', async () => {
    assert.equal(config.getConfig().maxBackups, 30);
    const stored = (await pool.query(`SELECT count(*)::int n FROM backups WHERE status IN ('success','in_progress')`)).rows[0].n;
    process.env.BACKUP_MAX_COUNT = String(stored); // the limit is now reached
    try {
      const res = await fetch(base, { method: 'POST', headers: { Authorization: `Bearer ${superToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'database', note: 'Over the limit' }) });
      assert.equal(res.status, 409);
      assert.equal((await res.json()).code, 'BACKUP_LIMIT_REACHED');
      assert.equal((await pool.query(`SELECT count(*)::int n FROM backups WHERE status IN ('success','in_progress')`)).rows[0].n, stored, 'nothing was deleted');

      const latest = await repo.latestSuccessful();
      const del = await fetch(`${base}/${latest.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${superToken}` } });
      assert.equal(del.status, 409);
      assert.equal((await del.json()).code, 'LATEST_BACKUP');

      const older = (await pool.query(`SELECT * FROM backups WHERE status = 'success' AND id <> $1 ORDER BY started_at LIMIT 1`, [latest.id])).rows[0];
      const ok = await fetch(`${base}/${older.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${superToken}` } });
      assert.equal(ok.status, 200);
      assert.equal(await adapter().exists(keyOf(older)), false, 'the file is removed from storage');

      // a slot is free again
      const again = await fetch(base, { method: 'POST', headers: { Authorization: `Bearer ${superToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'database', note: 'Fits again' }) });
      assert.equal(again.status, 202);
      await waitIdle();
    } finally {
      process.env.BACKUP_MAX_COUNT = '30';
    }
  });

  // ---- optional document-bucket backup, against a real S3-compatible server ---------

  describe('document storage bucket (BACKUP_INCLUDE_SUPABASE_STORAGE)', {
    skip: process.env.BACKUP_TEST_DOCS_BUCKET && process.env.BACKUP_TEST_S3_ENDPOINT
      ? false
      : 'set BACKUP_TEST_DOCS_BUCKET (and the BACKUP_TEST_S3_* settings) to test with a real bucket',
  }, () => {
    let PutObjectCommand;
    let GetObjectCommand;
    let ListObjectsV2Command;
    let DeleteObjectCommand;
    let client;
    const bucket = process.env.BACKUP_TEST_DOCS_BUCKET;
    const body = (label) => Buffer.concat([Buffer.from(`SLTE-${label}-`), crypto.randomBytes(3000)]);
    const originals = {
      'documents/a-front.png': body('front'),
      'documents/b-back.png': body('back'),
      'signatures/c.png': body('sig'),
    };
    const listKeys = async () => (await client.send(new ListObjectsV2Command({ Bucket: bucket }))).Contents?.map((o) => o.Key).sort() || [];
    const read = async (key) => Buffer.from(await (await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body.transformToByteArray());
    const put = (key, data) => client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentLength: data.length, ContentType: 'image/png', Metadata: { 'x-encrypted': 'true' } }));

    const withDocuments = async (fn) => {
      Object.assign(process.env, {
        BACKUP_INCLUDE_SUPABASE_STORAGE: 'true',
        STORAGE_ENDPOINT: process.env.BACKUP_TEST_S3_ENDPOINT,
        STORAGE_BUCKET: bucket,
        STORAGE_ACCESS_KEY: process.env.BACKUP_TEST_S3_ACCESS_KEY,
        STORAGE_SECRET_KEY: process.env.BACKUP_TEST_S3_SECRET_KEY,
        STORAGE_REGION: 'us-east-1',
      });
      try {
        return await fn();
      } finally {
        for (const key of ['BACKUP_INCLUDE_SUPABASE_STORAGE', 'STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY', 'STORAGE_REGION']) delete process.env[key];
      }
    };

    before(async () => {
      ({ PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = await import('@aws-sdk/client-s3'));
      await withDocuments(async () => {
        client = m.docs.createDocumentClient();
        for (const key of await listKeys()) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        for (const [key, data] of Object.entries(originals)) await put(key, data);
      });
    });

    test('is off by default: a "files" backup then holds no bucket data and never touches the bucket', async () => {
      const row = await makeBackup('database_files', 'Flag off');
      assert.deepEqual(row.contents, { files: true, documents: null });
    });

    test('when turned on, the bucket is downloaded into the encrypted bundle and described in the backup', async () => {
      await withDocuments(async () => {
        const row = await makeBackup('database_files', 'With the document bucket');
        assert.equal(row.contents.files, true);
        assert.deepEqual(row.contents.documents, [{ bucket, count: 3, bytes: Object.values(originals).reduce((n, b) => n + b.length, 0) }]);

        const plain = path.join(root, 'docs-inspect.tar');
        const out = path.join(root, 'docs-inspect');
        fs.mkdirSync(out, { recursive: true });
        await m.crypto.decryptFile(await fetchStored(row), plain);
        await commands.tarExtract(plain, out);
        const index = JSON.parse(fs.readFileSync(path.join(out, 'storage', 'index.json'), 'utf8'));
        assert.equal(index.buckets[0].objects.length, 3);
        const stored = await fetchStored(row);
        assert.ok(!fs.readFileSync(stored).includes(Buffer.from('SLTE-front-')), 'document bytes are not readable in the stored file');
      });
    });

    test('a database-only backup never includes the bucket, even when the flag is on', async () => {
      await withDocuments(async () => {
        const row = await makeBackup('database', 'DB only');
        assert.equal(row.contents.documents, null);
      });
    });

    test('restore uploads the files back and by default deletes nothing that is not in the backup', async () => {
      await withDocuments(async () => {
        const target = await makeBackup('database_files', 'Restore documents');
        // damage the bucket: change one file, remove one, add two that the backup does not know about
        await put('documents/a-front.png', Buffer.from('CORRUPTED'));
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: 'signatures/c.png' }));
        await put('documents/new-upload-1.png', body('new1'));
        await put('documents/new-upload-2.png', body('new2'));

        await service.startRestore({ id: target.id, actor });
        const result = await waitResult(target.id, 'restore_result');
        assert.equal(result.status, 'success', JSON.stringify(result));
        assert.deepEqual(result.documents, { uploaded: 3, deleted: 0 });

        for (const [key, data] of Object.entries(originals)) assert.ok((await read(key)).equals(data), `${key} restored byte for byte`);
        assert.deepEqual(await listKeys(), [...Object.keys(originals), 'documents/new-upload-1.png', 'documents/new-upload-2.png'].sort(), 'newer files were left alone');
        const audit = (await pool.query(`SELECT details FROM backup_audit_logs WHERE backup_id = $1 AND action = 'restored'`, [target.id])).rows.at(-1).details;
        assert.equal(audit.documentsDeleted, 0);
        assert.equal(audit.deleteExtraDocuments, false);
      });
    });

    test('with the explicit option, files that are not in the backup are deleted — and only those', async () => {
      await withDocuments(async () => {
        const target = await makeBackup('database_files', 'Restore documents, delete extras');
        await put('documents/stray.png', body('stray'));
        await service.startRestore({ id: target.id, actor, deleteExtraDocuments: true });
        const result = await waitResult(target.id, 'restore_result');
        assert.equal(result.status, 'success', JSON.stringify(result));
        // The two "new upload" files already existed when this backup was taken, so they are part of it
        // and stay; only the stray file (added after the backup) is deleted.
        assert.equal(result.documents.deleted, 1);
        assert.deepEqual(await listKeys(), [...Object.keys(originals), 'documents/new-upload-1.png', 'documents/new-upload-2.png'].sort());
      });
    });

    test('the option is refused for a backup that has no bucket data, and is false unless explicitly true', async () => {
      const plain = await makeBackup('database', 'No documents');
      await assert.rejects(service.startRestore({ id: plain.id, actor, deleteExtraDocuments: true }), (e) => e.code === 'NO_DOCUMENTS');
      assert.equal(lock.getActiveJob(), null);
      // over HTTP the flag must be the boolean true; the string "true" is ignored
      const res = await fetch(`${base}/${plain.id}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${superToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'RESTORE', password: PASSWORD, deleteExtraDocuments: 'true' }),
      });
      assert.equal(res.status, 202);
      await waitResult(plain.id, 'restore_result');
    });
  });

  // ---- Supabase-style conditions ------------------------------------------------

  describe('Supabase-style conditions', () => {
    const urlFor = (user, password, database = 'postgres') =>
      `postgresql://${user}:${password}@${adminClientConfig.host}:${adminClientConfig.port}/${database}`;

    test('without CREATEDB, test restore fails with a friendly message and no leftovers', async () => {
      const admin = new pg.Client(adminClientConfig);
      await admin.connect();
      await admin.query(`CREATE ROLE slt_limited LOGIN PASSWORD 'limited-pw' NOCREATEDB`);
      await admin.end();
      try {
        const row = await makeBackup();
        process.env.BACKUP_TEST_RESTORE_URL = urlFor('slt_limited', 'limited-pw');
        await service.startTestRestore({ id: row.id, actor });
        const result = await waitResult(row.id, 'test_restore_result');
        assert.equal(result.status, 'failed');
        assert.match(result.error, /CREATEDB/);
        assert.match(result.error, /BACKUP_TEST_RESTORE_URL/, 'names the setting involved');
        assert.match(result.error, /Grant it/, 'says how to fix it');
        assert.deepEqual(await stableTempDatabases(), []);
      } finally {
        delete process.env.BACKUP_TEST_RESTORE_URL;
        const cleanup = new pg.Client(adminClientConfig);
        await cleanup.connect();
        await cleanup.query('DROP ROLE IF EXISTS slt_limited');
        await cleanup.end();
      }
    });

    test('a separate test-restore URL is used when set', async () => {
      const row = await makeBackup();
      process.env.BACKUP_TEST_RESTORE_URL = urlFor(adminClientConfig.user, adminClientConfig.password);
      try {
        await service.startTestRestore({ id: row.id, actor });
        const result = await waitResult(row.id, 'test_restore_result');
        assert.equal(result.status, 'passed', JSON.stringify(result));
        assert.deepEqual(await stableTempDatabases(), []);
        assert.equal((await service.getSettings()).testRestoreTarget, 'BACKUP_TEST_RESTORE_URL');
      } finally {
        delete process.env.BACKUP_TEST_RESTORE_URL;
      }
    });

    test('a pooled DATABASE_URL is refused before anything is recorded; BACKUP_DATABASE_URL fixes it', async () => {
      const liveUrl = process.env.DATABASE_URL;
      const count = async () => (await pool.query('SELECT count(*)::int n FROM backups')).rows[0].n;
      const before = await count();
      process.env.DATABASE_URL = `postgresql://postgres:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`;
      try {
        await assert.rejects(service.startBackup({ type: 'database', note: 'Pooled URL', actor }), (e) => e.code === 'DB_POOLER_NOT_ALLOWED');
        assert.equal(await count(), before, 'no backup row was created');
        const settings = await service.getSettings();
        assert.equal(settings.database.ok, false);
        assert.ok(!JSON.stringify(settings).includes('pw@'), 'no credentials in settings');

        process.env.BACKUP_DATABASE_URL = liveUrl; // the direct connection
        const row = await makeBackup('database', 'Direct URL');
        assert.equal(row.status, 'success');
        assert.equal((await service.getSettings()).database.source, 'BACKUP_DATABASE_URL');
      } finally {
        process.env.DATABASE_URL = liveUrl;
        delete process.env.BACKUP_DATABASE_URL;
      }
    });

    test('extensions living in an "extensions" schema (as on Supabase) back up, test-restore and restore', async () => {
      await pool.query('CREATE SCHEMA IF NOT EXISTS extensions');
      await pool.query('ALTER EXTENSION "uuid-ossp" SET SCHEMA extensions');
      try {
        const row = await makeBackup('database', 'Extension in its own schema');
        await service.startTestRestore({ id: row.id, actor });
        const test = await waitResult(row.id, 'test_restore_result');
        assert.equal(test.status, 'passed', JSON.stringify(test));
        assert.ok(test.checks.some((c) => c.name === 'Extensions prepared' && /uuid-ossp/.test(c.detail)));

        const before = await snapshot();
        await pool.query(`UPDATE customers SET name = 'EDITED' WHERE phone LIKE '%3'`);
        await service.startRestore({ id: row.id, actor });
        const restore = await waitResult(row.id, 'restore_result');
        assert.equal(restore.status, 'success', JSON.stringify(restore));
        assert.deepEqual(await snapshot(), before);
        const ext = (await pool.query(`SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'uuid-ossp'`)).rows[0];
        assert.equal(ext.nspname, 'extensions', 'the extension was left as the database had it');
      } finally {
        await pool.query('ALTER EXTENSION "uuid-ossp" SET SCHEMA public');
      }
    });
  });

  test('a normal Admin gets 403 from the real API', async () => {
    for (const [method, route] of [['GET', '/summary'], ['GET', ''], ['POST', ''], ['GET', '/audit']]) {
      const res = await fetch(base + route, { method, headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
      assert.equal(res.status, 403, `${method} ${route}`);
    }
  });
});
