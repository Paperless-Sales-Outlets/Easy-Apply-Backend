# Backup and Restore

Manual, encrypted database backups for the SLT EasyApply portal, run from the **Backup Dashboard** in the admin portal. **Super Admin only.**

There is no scheduler. Nothing is created, restored or deleted unless a Super Admin does it.

> Backups contain customer personal data (covered by Sri Lanka's Personal Data Protection Act). Backup files are encrypted, but treat every copy as sensitive.

## How it works

| Step | What happens |
|---|---|
| 1. Dump | `pg_dump` (custom format, compressed) of the `public` schema. The backup-history tables (`backups`, `backup_audit_logs`) are excluded so a restore can never roll back the backup history or its audit trail. |
| 2. Files (optional) | "Database + uploaded files" also archives the uploads folder (`BACKUP_UPLOADS_PATH`, default `./uploads`). Customer documents held in the S3 document bucket are **not** included. |
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
5. **Database privileges:** *Test restore* needs the database user to have `CREATEDB`. *Restore* needs a direct connection that can drop and recreate the portal's tables (not a transaction-mode pooler such as Supabase port 6543; use the direct port 5432 connection for `DATABASE_URL`, or point the backup tools at it).
6. **Behind nginx:** set `TRUST_PROXY=1` so the activity log records real client IP addresses.
7. Restart the backend (`pm2 restart ... --update-env`) and create the first Super Admin.

All settings are documented in `.env.example` under "Backup & Restore".

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
Use a dedicated private bucket and credentials, separate from the customer-document bucket. A single upload is limited to 5 GB.

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

Restore must be run on a single backend process (the maintenance flag and the job lock live in the process, with a PostgreSQL advisory lock as a second guard). The portal runs one PM2 process today.

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
| `POST /:id/restore` | `{ confirmation: "RESTORE", password }` (202) |
| `POST /:id/download-link`, `GET /downloads/:token` | Password-confirmed, single-use download |
| `DELETE /:id` | Delete (not the latest successful backup) |
| `GET /audit`, `GET /audit/export` | Activity log; CSV |

Tokens in the query string are rejected on these routes.

## Tests

```bash
npm test                                        # role checks, crypto, storage adapters (no database needed)
BACKUP_TEST_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres \
  node --test --test-concurrency=1 tests/backupService.test.js
```
The service tests (backup, verify, test restore, restore, delete, the 30-backup limit, re-authentication, activity log) create tables and databases, so they run **only** against a disposable local PostgreSQL and refuse any non-local host. `pg_dump` and `pg_restore` are replaced by fakes there, so run a real test restore on the server after setup.

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
