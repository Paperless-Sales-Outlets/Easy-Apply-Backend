import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { getDbConnection, getTestRestoreConnection, isPoolerConnection } from '../services/backup/config.js';
import { buildRestoreList, detectExtensions } from '../services/backup/restoreList.js';
import { redact } from '../services/backup/errors.js';

// Supabase compatibility, checked without connecting to any database.

const KEYS = ['DATABASE_URL', 'POSTGRES_URI', 'BACKUP_DATABASE_URL', 'BACKUP_TEST_RESTORE_URL', 'BACKUP_ADMIN_DATABASE', 'DATABASE_SSL'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const clear = () => KEYS.forEach((k) => delete process.env[k]);
beforeEach(clear);
after(() => KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))));

const POOLED = 'postgresql://postgres.abcdefgh:s3cretPW@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require';
const DIRECT = 'postgresql://postgres:s3cretPW@db.abcdefgh.supabase.co:5432/postgres?sslmode=require';

describe('direct connection, never the pooler', () => {
  test('a pooled DATABASE_URL is refused with a clear message', () => {
    process.env.DATABASE_URL = POOLED;
    assert.throws(
      () => getDbConnection(),
      (e) => e.code === 'DB_POOLER_NOT_ALLOWED' && /BACKUP_DATABASE_URL/.test(e.message) && !e.message.includes('s3cretPW')
    );
  });

  test('BACKUP_DATABASE_URL wins, so the live app can stay on the pooler', () => {
    process.env.DATABASE_URL = POOLED;
    process.env.BACKUP_DATABASE_URL = DIRECT;
    const c = getDbConnection();
    assert.equal(c.host, 'db.abcdefgh.supabase.co');
    assert.equal(c.port, '5432');
    assert.equal(c.ssl, true);
  });

  test('a pooled BACKUP_DATABASE_URL is refused too', () => {
    process.env.BACKUP_DATABASE_URL = POOLED;
    assert.throws(() => getDbConnection(), (e) => e.code === 'DB_POOLER_NOT_ALLOWED' && /BACKUP_DATABASE_URL points at a transaction-mode pooler/.test(e.message));
  });

  test('refuses a transaction-mode pooler (port 6543 or the pgbouncer flag), whatever the host is called', () => {
    const base = { host: 'db.example.com', port: '5432', pgbouncer: false };
    assert.equal(isPoolerConnection(base), false);
    assert.equal(isPoolerConnection({ ...base, port: '6543' }), true);
    assert.equal(isPoolerConnection({ ...base, host: 'aws-0-x.pooler.supabase.com', port: '6543' }), true);
    assert.equal(isPoolerConnection({ ...base, pgbouncer: true }), true);
  });

  test('the Supabase SESSION pooler (same pooler host, port 5432) is accepted — for networks without IPv6', () => {
    process.env.BACKUP_DATABASE_URL = 'postgresql://postgres.abcdefgh:s3cretPW@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require';
    const c = getDbConnection();
    assert.equal(c.host, 'aws-0-ap-southeast-1.pooler.supabase.com');
    assert.equal(c.port, '5432');
    assert.equal(c.user, 'postgres.abcdefgh');
    assert.equal(isPoolerConnection(c), false);
  });

  test('the same pooler host on port 6543 stays refused', () => {
    process.env.BACKUP_DATABASE_URL = 'postgresql://postgres.abcdefgh:s3cretPW@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
    assert.throws(() => getDbConnection(), (e) => e.code === 'DB_POOLER_NOT_ALLOWED');
  });

  test('a local direct URL is accepted', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:pw@127.0.0.1:5432/app';
    assert.equal(getDbConnection().database, 'app');
  });

  test('test restore uses the backup connection by default, or its own URL', () => {
    process.env.DATABASE_URL = DIRECT;
    process.env.BACKUP_ADMIN_DATABASE = 'postgres';
    let t = getTestRestoreConnection();
    assert.equal(t.separate, false);
    assert.equal(t.host, 'db.abcdefgh.supabase.co');

    process.env.BACKUP_TEST_RESTORE_URL = 'postgresql://tester:pw@scratch.internal:5432/postgres';
    t = getTestRestoreConnection();
    assert.equal(t.separate, true);
    assert.equal(t.host, 'scratch.internal');

    process.env.BACKUP_TEST_RESTORE_URL = POOLED;
    assert.throws(() => getTestRestoreConnection(), (e) => e.code === 'DB_POOLER_NOT_ALLOWED');
  });

  test('credentials from either URL never appear in redacted text', () => {
    process.env.BACKUP_DATABASE_URL = DIRECT;
    const text = redact(`connect failed for ${DIRECT} (password s3cretPW)`);
    assert.ok(!text.includes('s3cretPW'));
  });
});

describe('restore list: Supabase- and platform-owned objects are left alone', () => {
  const toc = [
    '; Archive created at 2026-11-20',
    '8; 2615 2200 SCHEMA - public postgres',
    '3079; 0 0 EXTENSION - uuid-ossp',
    '3080; 0 0 COMMENT - EXTENSION "uuid-ossp"',
    '3081; 0 0 COMMENT - SCHEMA public postgres',
    '215; 1259 16400 TABLE public users postgres',
    '4912; 0 16400 TABLE DATA public users postgres',
    '5001; 6104 16999 PUBLICATION - supabase_realtime postgres',
    '5002; 6106 17001 PUBLICATION TABLE public users postgres',
    '218; 1259 16410 TABLE public applications postgres',
    '4400; 2606 16420 CONSTRAINT public users users_pkey postgres',
  ].join('\n');

  test('comments out the schema, extensions and publications, and keeps tables, data and constraints', () => {
    const { text, skipped } = buildRestoreList(toc);
    assert.equal(skipped.length, 6);
    const lines = text.split('\n');
    for (const keep of ['TABLE public users', 'TABLE DATA public users', 'TABLE public applications', 'CONSTRAINT public users users_pkey']) {
      assert.ok(lines.some((l) => !l.startsWith(';') && l.includes(keep)), `${keep} must stay`);
    }
    for (const drop of ['SCHEMA - public', 'EXTENSION - uuid-ossp', 'PUBLICATION - supabase_realtime', 'PUBLICATION TABLE']) {
      assert.ok(lines.some((l) => l.startsWith(';') && l.includes(drop)), `${drop} must be commented out`);
    }
  });

  test('is idempotent on an already-filtered list', () => {
    const once = buildRestoreList(toc).text;
    assert.equal(buildRestoreList(once).text, once);
  });
});

describe('extensions the dump relies on', () => {
  test('finds the schema an extension lives in (Supabase uses "extensions")', () => {
    const sql = `
      CREATE TABLE public.users (id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL);
      CREATE TABLE public.tokens (t bytea DEFAULT extensions.gen_random_bytes(16));
      CREATE INDEX ix ON public.users USING gin (name public.gin_trgm_ops);`;
    assert.deepEqual(detectExtensions(sql), [
      { extension: 'uuid-ossp', schema: 'extensions' },
      { extension: 'pgcrypto', schema: 'extensions' },
      { extension: 'pg_trgm', schema: 'public' },
    ]);
  });

  test('finds nothing when no extension is used', () => {
    assert.deepEqual(detectExtensions('CREATE TABLE public.a (id integer);'), []);
  });

  test('uuid-ossp in the public schema', () => {
    assert.deepEqual(detectExtensions('id uuid DEFAULT public.uuid_generate_v4()'), [{ extension: 'uuid-ossp', schema: 'public' }]);
  });
});
