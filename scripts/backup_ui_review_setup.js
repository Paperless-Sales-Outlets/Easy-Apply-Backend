import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import pg from 'pg';

// Prepares a DISPOSABLE local database for reviewing the Backup Dashboard UI in a
// browser (see docs/BACKUP_AND_RESTORE.md, "Reviewing the UI"):
//   - creates database `slt_ui_review` on the server given by BACKUP_TEST_DATABASE_URL
//   - loads db/schema.sql and the realistic seed data used by the integration tests
//   - creates an Admin, a Manager and a Staff account with random passwords (only Admin may use
//     backups under the default BACKUP_ALLOWED_ROLES; the other two must be refused)
//   - optionally adds a big table so a real backup takes several seconds (progress is visible)
//
//   BACKUP_TEST_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres \
//     node scripts/backup_ui_review_setup.js <credentials-output.json> [--bulk]
//
// Refuses any non-local server. The credentials file is written for the review script and is
// never printed.

const [credentialsFile, ...flags] = process.argv.slice(2);
const adminUrl = process.env.BACKUP_TEST_DATABASE_URL;
if (!credentialsFile || !adminUrl) {
  console.error('Usage: BACKUP_TEST_DATABASE_URL=<local server url> node scripts/backup_ui_review_setup.js <credentials.json> [--bulk]');
  process.exit(1);
}
const url = new URL(adminUrl);
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
  console.error(`Refusing to run against non-local host "${url.hostname}".`);
  process.exit(1);
}

const DB = 'slt_ui_review';
const base = {
  host: url.hostname,
  port: Number(url.port || 5432),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
};

const admin = new pg.Client({ ...base, database: 'postgres' });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${DB}`);
await admin.end();

const db = new pg.Client({ ...base, database: DB });
await db.connect();
await db.query(fs.readFileSync(path.resolve('db/schema.sql'), 'utf8'));
await db.query(fs.readFileSync(path.resolve('tests/fixtures/backup-seed.sql'), 'utf8'));

const accounts = {};
for (const [key, role] of [['admin', 'Admin'], ['manager', 'Manager'], ['staff', 'Staff']]) {
  const email = `${key.toLowerCase()}.review@slt.test`;
  const password = crypto.randomBytes(9).toString('base64url');
  await db.query(
    `INSERT INTO users (name, email, role, permissions, password_hash) VALUES ($1, $2, $3, $4, $5)`,
    [`${role} Reviewer`, email, role, key === 'admin' ? [] : ['dashboard'], await bcrypt.hash(password, 8)]
  );
  accounts[key] = { email, password, role };
}

if (flags.includes('--bulk')) {
  // ~200 MB of poorly compressible rows: a backup then takes long enough to watch its progress.
  await db.query(`CREATE TABLE ui_review_bulk AS
                  SELECT g AS id, md5(g::text) || md5((g * 7)::text) || md5((g * 13)::text) AS payload
                  FROM generate_series(1, 2500000) AS g`);
}
await db.end();

fs.writeFileSync(
  credentialsFile,
  JSON.stringify({ database: `postgresql://${base.user}:${encodeURIComponent(base.password)}@${base.host}:${base.port}/${DB}`, accounts }, null, 2),
  { mode: 0o600 }
);
console.log(`Review database "${DB}" is ready; credentials written to ${credentialsFile}.`);
