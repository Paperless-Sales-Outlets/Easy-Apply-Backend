# Backup and Restore

Manual, encrypted database backups for the SLT EasyApply portal, run from the **Backup Dashboard** in the admin portal. **Super Admin only.**

There is no scheduler. Nothing is created, restored or deleted unless a Super Admin does it.

> Backups contain customer personal data (covered by Sri Lanka's Personal Data Protection Act). Backup files are encrypted, but treat every copy as sensitive.

## How it works

| Step | What happens |
|---|---|
| 1. Dump | `pg_dump` (custom format, compressed) of the `public` schema, without publications, subscriptions or security labels (platform-owned on Supabase). The backup-history tables (`backups`, `backup_audit_logs`) are excluded so a restore can never roll back the backup history or its audit trail. |
| 2. Files (optional) | "Database + uploaded files" also archives the uploads folder (`BACKUP_UPLOADS_PATH`, default `./uploads`). Customer documents in the storage bucket are included only if you turn on [`BACKUP_INCLUDE_SUPABASE_STORAGE`](#customer-documents-in-the-storage-bucket-optional). |
| 3. Encrypt | Everything is bundled and encrypted with AES-256-GCM using `BACKUP_ENCRYPTION_KEY`. File extension: `.sltbak`. |
| 4. Checksum | SHA-256 of the stored file is recorded, then the stored copy is re-read and compared. |
| 5. Store | Written through a storage adapter: local folder or S3-compatible bucket. |

Backups run as background jobs. The API answers immediately (HTTP 202) and the dashboard polls for status. Only one backup, verify, test restore or restore runs at a time. `pg_dump` runs at low priority (`nice`) on Linux and takes only a consistent snapshot, so it does not block the live portal.

### Role model

Access requires `users.role = 'Super Admin'`. It is enforced on the server: every route in `routes/admin/backupRoutes.js` passes through `requireSuperAdmin`, and anyone else gets **403**. Hiding the menu item is only cosmetic.

A Super Admin keeps all Admin permissions. The role cannot be assigned or edited from User Management; create one on the server:

```bash
node scripts/create_super_admin.js someone@slt.lk            # promote an existing staff account
node scripts/create_super_admin.js someone@slt.lk --revoke   # back to Admin
```

The account must have a password (download and restore ask for it again). The person must sign out and in again.

## Server setup

1. **Apply the migration** (once per database):
   ```bash
   psql "$DATABASE_URL" -f db/migrations/2026-11-19-backups.sql
   ```
   (`db/schema.sql` contains the same tables for fresh installs.)
2. **Install PostgreSQL client tools** (`pg_dump`, `pg_restore`) with a major version **equal to or newer than** the database server, plus `tar`. Otherwise set `PG_DUMP_PATH` / `PG_RESTORE_PATH`.
3. **Generate the encryption key** and put it in the server `.env`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Keep a copy in a password manager or secrets vault, separate from the backups. **Without this key a backup cannot be restored.** There is no fallback key; with no key set, backups are refused.
4. **Choose storage** (see below) and make the folder or bucket.
5. **Database connection:** backups use `BACKUP_DATABASE_URL`, the **direct** connection (normally port 5432), never the pooler (port 6543). If only a pooled `DATABASE_URL` exists, backups refuse to start with a clear message. See [Supabase](#supabase) below.
6. **Database privileges:** *Test restore* creates a temporary database, so that user needs `CREATEDB` (or set `BACKUP_TEST_RESTORE_URL` to a separate server where it is allowed). *Restore* needs a user that can drop and recreate the portal's tables.
7. **Behind nginx:** set `TRUST_PROXY=1` so the activity log records real client IP addresses.
8. **Run the backend as ONE instance** (see [Single instance](#single-instance)).
9. Restart the backend (`pm2 reload ecosystem.config.cjs --update-env`) and create the first Super Admin.

All settings are documented in `.env.example` under "Backup & Restore". A step-by-step server checklist with a check command for every step is in [BACKUP_DEPLOYMENT_CHECKLIST.md](BACKUP_DEPLOYMENT_CHECKLIST.md).

## Storage

Selected by `BACKUP_STORAGE`; switching needs no code change.

**Local (default)**
```
BACKUP_STORAGE=local
BACKUP_LOCAL_PATH=/var/backups/slt-easyapply
```
Use a folder outside the web root and the project folder, owned by the service user, mode `700`.

**S3-compatible (AWS S3, MinIO, ...)**
```
BACKUP_STORAGE=s3
BACKUP_S3_ENDPOINT=            # empty for AWS; e.g. https://minio.internal:9000
BACKUP_S3_BUCKET=slt-backups
BACKUP_S3_REGION=ap-southeast-1
BACKUP_S3_ACCESS_KEY=...
BACKUP_S3_SECRET_KEY=...
BACKUP_S3_PREFIX=backups
```
Use a dedicated private bucket and credentials, separate from the customer-document bucket. Files up to 64 MiB are uploaded in one request; larger files use a **multipart upload** (parts of at least 16 MiB, one at a time, growing automatically so even a very large backup stays under S3's 10,000-part limit). A failed upload is aborted so no orphaned parts remain. There is therefore no 5 GB limit.

Each backup records the backend it was stored in. After switching, older backups stay in the old backend and can only be used while those settings are still available (otherwise the dashboard says so).

## Creating a backup

1. Sign in as a Super Admin and open **Backups**.
2. Click **Create backup**, choose *Full database* or *Database + uploaded files*, and enter a required note (for example "Before release v2.3").
3. Confirm. The row appears as **In progress** with its current stage, then **Success** or **Failed**. You can keep using the portal.

Limits and warnings:
- **30 backups maximum** (`BACKUP_MAX_COUNT`). At the limit the dialog tells you to delete old backups first; nothing is ever deleted automatically. Failed attempts do not count.
- A banner warns when the last successful backup is older than `BACKUP_WARNING_DAYS` (default 7).
- The most recent successful backup cannot be deleted.

## Verify integrity

**Verify integrity** re-downloads the file, recomputes the SHA-256 and compares it to the stored value, decrypts it (the GCM tag proves it was not altered), unpacks it and runs `pg_restore --list`. The result is shown under Details.

## Test restore

**Test restore** restores the backup into a temporary database named `slt_backup_test_<random>`, counts the rows of every restored table, checks that every table in the archive exists, then drops the temporary database. The live database is never touched. Run this regularly: a backup that has never been restored is not proven.

## Download

1. Row menu, then **Download…**, then enter your password again.
2. The server issues a link valid for 60 seconds (`BACKUP_DOWNLOAD_TTL_SEC`) and usable once.
3. The browser fetches it with your sign-in token as well, so a copied link is useless on its own. Wrong passwords are throttled (5 tries, then a 15-minute lock).

Every download, and every failed attempt, is recorded in the activity log.

To open a downloaded file offline (needs the same `BACKUP_ENCRYPTION_KEY` in the environment):
```bash
node scripts/backup_decrypt.js backup.sltbak backup.tar
tar -xf backup.tar        # database.dump, manifest.json [, uploads.tgz]
pg_restore --list database.dump
```

## Restore runbook

Restoring **replaces all current data** with the backup. Plan it.

**Before**
1. Tell staff: the portal is unavailable to everyone for the duration.
2. Run **Test restore** on the backup you intend to use, and confirm it passed.
3. Make sure at least one backup slot is free (the safety backup counts toward the limit) and there is disk space: about twice the database size in `BACKUP_TMP_DIR`.
4. Note the time of the backup you are restoring: data entered after it will be lost from the live system.

**Do it**
1. **Backups**, then the row menu, then **Restore…**
2. Read the warnings, type `RESTORE`, enter your password, and press **Restore now**.
3. The server then:
   1. takes a fresh backup of the current data labelled **Auto pre-restore backup** (if this fails, the restore is cancelled and nothing changes);
   2. downloads, checksums, decrypts and checks the chosen backup;
   3. puts the API into maintenance mode (other requests get 503) and replaces the data in one transaction (`pg_restore --clean --if-exists --single-transaction`), so a failure leaves the data unchanged;
   4. for "Database + uploaded files" backups, swaps in the archived uploads folder; the previous folder is kept beside it as `uploads.before-restore-<timestamp>`.
4. Keep the page open; it shows the stage and the result.

**After**
1. Staff accounts, passwords and sessions return to the state in the backup, so you may be signed out. If your own account did not exist then, you will need another Super Admin.
2. Spot-check the portal (sign in, open a recent application).
3. If the result is wrong, restore the "Auto pre-restore backup" the same way.
4. The restore, with its safety backup ID, is in the activity log.

**If it fails:** the message appears on the backup's Details and in the server log. Failures before the data swap leave live data untouched. Maintenance mode always ends. The safety backup is kept.

Restore must be run on a single backend process; see [Single instance](#single-instance).

The restore uses a filtered `pg_restore --use-list`, so the `public` schema itself, extensions and publications are never dropped or recreated: only tables, data, sequences, indexes and constraints are replaced. This is what makes it safe on Supabase, where those objects belong to the platform.

## Single instance

The job lock ("one backup or restore at a time"), the maintenance-mode switch during a restore and the download tokens live in the memory of **one** backend process. With several instances (PM2 cluster mode, `instances` above 1, or a second server behind a load balancer) another instance would not see them: it could start a second job, keep serving customers during a restore, or reject a download link.

- Run the backend in **PM2 fork mode with one instance**: `ecosystem.config.cjs` does this (`pm2 start ecosystem.config.cjs`; the process name matches `.github/workflows/deploy.yml`).
- At startup the backend logs a clear warning if it detects cluster mode, `instances` above 1 or a second PM2 instance, and **backup, verify, test restore and restore are refused (503, `MULTI_INSTANCE`)** until that is fixed. The Storage & retention tab shows the same status.
- `BACKUP_ALLOW_MULTI_INSTANCE=true` overrides the refusal. Do not use it for restores.
- `deploy.yml` starts the process with `pm2 start server.js --name ...` (fork mode, one instance) if it does not exist yet, which is fine. If you ever change the deployment to cluster mode, backups stop working by design.

## Supabase

Backups must talk to PostgreSQL directly:

- Set `BACKUP_DATABASE_URL` to the **direct** connection string (`db.<project-ref>.supabase.co`, port **5432**, `?sslmode=require`). The portal itself can keep using the pooled `DATABASE_URL`. If `DATABASE_URL` is a pooler address (port 6543, host containing `pooler`, or `pgbouncer=true`) and `BACKUP_DATABASE_URL` is not set, backups refuse to start: pg_dump needs a session-level connection and a restore must run as one transaction.
- The direct Supabase host is **IPv6 only** unless the project has the IPv4 add-on. If the server cannot reach it, either enable the add-on or use the session-mode pooler address on port 5432 *only after confirming* a pg_dump works through it (the check above treats any host containing `pooler` as a pooler and refuses it by design, so this needs a decision).
- **Extensions** (`uuid-ossp`, `pgcrypto`, ...) are never dumped or dropped. For *Test restore*, the extensions the tables use are detected in the archive and created in the temporary database, in the same schema as in the source (Supabase uses `extensions`). If one is unavailable on the test server, the message says which.
- **Supabase-owned objects:** the dump leaves out publications (e.g. `supabase_realtime`), subscriptions, security labels, ownership and grants, and the restore never touches the `public` schema object itself.
- **CREATEDB:** *Test restore* needs it. Without it the result says so and suggests `BACKUP_TEST_RESTORE_URL` (a separate PostgreSQL server where a temporary database may be created). *Verify integrity* works without it.
- Row-level-security policies that name Supabase roles (`anon`, `authenticated`) would need those roles on the test server. The current schema has no such policies.

### Supabase checklist: confirm on the real project

1. The direct connection string (port 5432) works from the server, and whether IPv6 or the IPv4 add-on is needed.
2. The database user in `BACKUP_DATABASE_URL` can read every table in `public` (for `pg_dump`) and can drop and recreate them (for restore). On Supabase the `postgres` user normally can.
3. Whether that user has `CREATEDB` (run the check in the deployment checklist). If not, choose a separate server for `BACKUP_TEST_RESTORE_URL`.
4. The PostgreSQL **major version** of the project (Dashboard, Database, Settings) and that the server's `pg_dump` is the same or newer.
5. Which extensions are installed and in which schema (`SELECT extname, extnamespace::regnamespace FROM pg_extension;`).
6. Whether any table has row-level security or policies that depend on Supabase roles.
7. Whether `public` contains anything that is not part of this application and should not be replaced by a restore.
8. A first real **Test restore** passes before any real restore is ever attempted.

## Customer documents in the storage bucket (optional)

Customer documents (NIC photos, signatures) live in the Supabase Storage bucket, not in the database or the `uploads/` folder. **By default they are not part of a backup.** To include them in "Database + uploaded files" backups:

```
BACKUP_INCLUDE_SUPABASE_STORAGE=true       # must be exactly "true"
BACKUP_SUPABASE_BUCKETS=kyc-documents      # optional; defaults to STORAGE_BUCKET
```

It reads the bucket with the portal's existing `STORAGE_*` credentials (read access is enough for backups; restore also needs write access, and delete access only if you use the delete option below).

- Objects are copied byte for byte (they are already encrypted by the portal with `DOCUMENT_ENCRYPTION_KEY`) into the backup, which is then encrypted again as a whole. **Keep `DOCUMENT_ENCRYPTION_KEY` safe too**: without it the restored documents cannot be opened.
- The backup then also contains customer documents, so it becomes larger and slower; the Backups table and Details show what each backup contains.
- A "Database" backup never includes the bucket, even when the flag is on.
- **Restore uploads the backed-up files back, overwriting files with the same name, and never deletes anything else.** Files customers uploaded after the backup stay in the bucket. The restore dialog has a separate, unticked option *"Also permanently delete bucket files that are not in this backup"* that deletes them; use it only when you really want the bucket to match the backup. It is recorded in the activity log.
- If the database restore succeeds but the bucket step fails, the message says the database was restored but a later step failed; run the restore again to finish.

## Encryption key safekeeping

Backups cannot be decrypted without `BACKUP_ENCRYPTION_KEY` (and restored documents cannot be opened without `DOCUMENT_ENCRYPTION_KEY`). If the server is lost and the keys were only in its `.env`, **every backup is useless**.

- Keep a copy of both keys **outside the server and outside the backup storage**: a company password manager or secrets vault, with access limited to the people who may restore.
- Record who holds the copies and review it when staff change.
- Changing the key does not re-encrypt existing backups: keep the old key for as long as old backups exist.
- Never commit keys, paste them in chat or tickets, or store them next to the backups.

## Activity log

Every action is recorded in `backup_audit_logs`: created, verified, downloaded, test restored, restored, deleted, failed, with who, when, IP address, result and details. It is read-only, filterable by action, result, date and search text, and exportable to CSV from the **Activity log** tab. The table is excluded from backups and restores.

## API (all Super Admin only, under `/api/admin/backups`)

| Method and path | Purpose |
|---|---|
| `GET /summary`, `GET /settings` | Dashboard figures; storage and server readiness |
| `GET /` | List (page, limit, status, type, search, from, to) |
| `POST /` | Start a backup `{ type: "database" or "database_files", note }` (202) |
| `GET /:id` | Details and recent activity |
| `POST /:id/verify`, `POST /:id/test-restore` | Start a check (202) |
| `POST /:id/restore` | `{ confirmation: "RESTORE", password, deleteExtraDocuments?: true }` (202). The last field must be the boolean `true` and is only valid for backups that include the document bucket. |
| `POST /:id/download-link`, `GET /downloads/:token` | Password-confirmed, single-use download |
| `DELETE /:id` | Delete (not the latest successful backup) |
| `GET /audit`, `GET /audit/export` | Activity log; CSV |

Tokens in the query string are rejected on these routes.

## Tests

Three layers, from fastest to most realistic:

```bash
npm run test:backup            # unit tests, no database: roles (403 everywhere), crypto, storage adapters,
                               # multipart (fake S3), Supabase rules, single-instance guard, bucket backup
BACKUP_TEST_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres \
  npm run test:backup            # + service tests against a real PostgreSQL with FAKE pg tools
BACKUP_TEST_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres \
  npm run test:backup:e2e        # REAL end to end: real pg_dump / pg_restore / tar, real HTTP + JWT
```

The database must be a **disposable local PostgreSQL superuser** server: the tests create and drop databases and refuse any non-local host. `docker-compose.backup-test.yml` provides PostgreSQL 17 and MinIO (`npm run backup-test:up`, `npm run backup-test:down`); that file has not been run on the machine it was written on, which had no Docker. The suite itself was run for real against native PostgreSQL 17.6 and an S3-compatible server.

The real end-to-end suite (`tests/integration/backupE2E.test.js`, with realistic seed data in `tests/fixtures/backup-seed.sql`) checks: full and files backups; verify (and tamper detection); test restore with correct row counts and the temporary database always dropped, even after a failure; a full restore that returns the data to exactly the backed-up state, with the automatic pre-restore backup, maintenance mode on and off, and the backup history and audit tables **not** rolled back; a restore that fails midway leaving the data unchanged; download links (once only, expiry, bearer token required, 403 for Admin); the 30-backup limit and the latest-backup delete rule; no `CREATEDB`; a pooled URL; extensions in their own schema; and the document-bucket option. Run it against S3 storage as well by adding:

```
BACKUP_TEST_S3_ENDPOINT=http://127.0.0.1:9000  BACKUP_TEST_S3_BUCKET=slt-backup-test
BACKUP_TEST_S3_ACCESS_KEY=...  BACKUP_TEST_S3_SECRET_KEY=...  BACKUP_TEST_DOCS_BUCKET=slt-docs-test
```

Put `pg_dump`/`pg_restore` on the PATH or set `PG_DUMP_PATH` / `PG_RESTORE_PATH` (client version equal to or newer than the server).

## Reviewing the UI

`Easy-Apply-Frontend/e2e/backupDashboard.review.mjs` drives the whole Backups page in Chrome with Playwright (75 checks: access control, create, progress, filters and pagination, details, verify, test restore, download, delete, restore, activity log and CSV, warnings, errors, narrow screens) and saves a screenshot of every screen to `docs/screenshots/backup/`. Prepare a disposable database with `scripts/backup_ui_review_setup.js`, start the backend and frontend against it (never against production), then run the script; the header of the script lists the environment variables.

## Troubleshooting

| Message | Cause and fix |
|---|---|
| Backup encryption is not configured | Set `BACKUP_ENCRYPTION_KEY` (64 hex characters) and restart |
| `pg_dump` / `pg_restore` was not found | Install the client tools or set `PG_DUMP_PATH` / `PG_RESTORE_PATH` |
| Not allowed to create the temporary test database | Grant `CREATEDB` to the database user, or set `BACKUP_ADMIN_DATABASE` |
| Storage folder not writable | Check `BACKUP_LOCAL_PATH` ownership and mode |
| Server version mismatch from `pg_dump` | Install client tools at least as new as the server |
| Checksum does not match | The file was altered or damaged; use another backup |
| The backup could not be decrypted | Wrong `BACKUP_ENCRYPTION_KEY` for that file |
| Backups cannot use the pooled DATABASE_URL (`DB_POOLER_NOT_ALLOWED`) | Set `BACKUP_DATABASE_URL` to the direct connection (port 5432) |
| Backups cannot run while the backend has more than one instance (`MULTI_INSTANCE`) | Run the backend in PM2 fork mode, one instance (`ecosystem.config.cjs`) |
| Test restore needs the CREATEDB privilege | Grant `CREATEDB`, or set `BACKUP_TEST_RESTORE_URL` to another PostgreSQL server |
| The database uses the "..." extension, which is not available on the test restore server | Install the extension on the server used for test restores |
| The document storage bucket cannot be reached (`DOCUMENTS_UNREACHABLE`) | Check `BACKUP_SUPABASE_BUCKETS` and the `STORAGE_*` settings, or turn `BACKUP_INCLUDE_SUPABASE_STORAGE` off |
| "The database was restored but a later step failed" | Run the restore again; the safety backup was kept |
