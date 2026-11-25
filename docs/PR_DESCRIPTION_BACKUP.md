# Manual Backup Dashboard (Admin access, configurable)

**Branch:** `runeth` → `new-flow`, in both `Easy-Apply-Backend` and `Easy-Apply-Frontend`. *Draft: not opened yet.*

## What this adds

A **Backups** page in the admin portal, for the roles listed in `BACKUP_ALLOWED_ROLES` (default: **Admin**), to create, check, download, restore and delete encrypted database backups. Backups are **manual only**: there is no scheduler, and nothing is ever deleted automatically.

**Backend**
- `backups` and legacy `backup_audit_logs` tables (migration `db/migrations/2026-11-19-backups.sql`, also in `db/schema.sql`); new backup events use the shared `audit_logs` service/table. The centralization migration copies historical activity without deleting source rows, and all history/audit tables are excluded from dumps.
- `pg_dump` custom-format backups, AES-256-GCM encryption (`BACKUP_ENCRYPTION_KEY`, no fallback), SHA-256 checksum re-checked after storing.
- Storage adapters selected by `BACKUP_STORAGE=local|s3` (default local); S3 uses multipart upload, so there is no 5 GB limit.
- Background jobs, one at a time: backup, verify, test restore (temporary database, always dropped), restore (automatic "Auto pre-restore backup", maintenance mode, single transaction), delete (not the latest successful backup).
- Password-confirmed, single-use, 60-second download links that also need the bearer token; every action recorded with user, time, IP and result; CSV export.
- 30-backup limit (`BACKUP_MAX_COUNT`) and stale-backup warning (`BACKUP_WARNING_DAYS`), both configurable.
- Supabase compatibility: session connection only (`BACKUP_DATABASE_URL`: direct or session pooler on port 5432; the transaction pooler on port 6543 is refused), extensions and platform-owned objects left alone, `BACKUP_TEST_RESTORE_URL` when `CREATEDB` is not available.
- **Optional, off by default:** include the customer-document storage bucket (`BACKUP_INCLUDE_SUPABASE_STORAGE`). Restore never deletes other bucket files unless explicitly asked.
- Single-instance guard (startup warning; operations refused in cluster mode) and `ecosystem.config.cjs`.
- Every `/api/admin/backups/*` route is behind `requireBackupAccess`: only the roles in `BACKUP_ALLOWED_ROLES` (comma-separated, default `Admin`, case-insensitive, active accounts only, never Customers) are let in; anyone else gets **403**. In production the team can restrict access by changing that one setting. There is **no Super Admin role**: it was removed, and `db/migrations/2026-11-21-remove-super-admin.sql` turns any existing "Super Admin" user into an Admin.
- `GET /api/admin/backups/access` tells the frontend whether to show the menu item, so no role name is hard-coded in the UI.

**Frontend**
- Backups page: summary tiles and warnings, create dialog (type, required note, confirm), live progress, filterable and paginated table, row actions (details, verify, download, test restore, restore, delete), activity log tab with CSV export, storage and retention tab.
- The menu item and page are hidden for every other role (the server enforces it regardless).

**Docs:** [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md) (how it works, runbook, Supabase, single instance, key safekeeping) and [BACKUP_DEPLOYMENT_CHECKLIST.md](BACKUP_DEPLOYMENT_CHECKLIST.md) (every server step, with a check command).

## How it was tested

**Real (no fakes), run on this machine:** native PostgreSQL 17.6 with the real `pg_dump`, `pg_restore` and `tar`, real encryption, real HTTP routes with real JWT auth, and an S3-compatible server (rclone `serve s3`; MinIO's Windows binary is no longer published).
- `tests/integration/backupE2E.test.js`: **21 tests with local storage, 27 with S3 storage and the document bucket**, against realistic seed data (non-ASCII text, JSONB, 2,800+ rows):
  - full and "Database + files" backups; verify, including tamper detection
  - test restore: correct row counts, temporary database always dropped (also after a failure)
  - full restore: data identical to the backup (per-table fingerprints), uploads folder restored, "Auto pre-restore backup" created, maintenance mode on and off, backup history and audit tables **not** rolled back
  - restore failing midway: database unchanged (single transaction), maintenance mode off
  - download link: works once, expires, rejected without a bearer token and for a normal Admin
  - 30-backup limit, latest-backup delete rule, 403 for every role that is not allowed, and `BACKUP_ALLOWED_ROLES` with several roles
  - no `CREATEDB`, pooled URL refused, extension in its own schema, document bucket (off by default, restore never deletes extras unless asked)
- `tests/integration/backupS3Multipart.test.js`: 5 tests with a fake client plus 3 against the real S3 server (including a 70 MiB file with the default threshold).
- **Browser review:** `Easy-Apply-Frontend/e2e/backupDashboard.review.mjs` (Playwright + Chrome) ran **79 checks** across every screen, as Admin (allowed), Manager and Staff (refused), with screenshots below. It found and fixed four UI problems.

**With fakes / offline:** 73 unit tests (roles on every endpoint, BACKUP_ALLOWED_ROLES, crypto, storage adapters, Supabase rules, single-instance guard, bucket backup against an in-memory S3) and 41 service tests with fake `pg_dump`/`pg_restore`. Frontend: 112 tests (11 new), lint clean, production build OK.

Bugs found by the real run and fixed (not visible with fakes):
1. Restore and test restore failed: a dump of the `public` schema lists `CREATE/DROP SCHEMA public` and extensions. Now restored through a filtered `pg_restore --use-list`.
2. S3-compatible servers rejected uploads (`MissingContentLength`). Single uploads now send a buffer and the SDK's automatic checksum trailer is off.
3. UI (browser review): "In progress" badge unreadable on the dark tiles; row actions pushed off-screen at 1440 px; summary tiles clipped and tab labels missing on phones.

## Screenshots

All in `docs/screenshots/backup/` (taken by the review script):

| | |
|---|---|
| Summary, table, pagination | `11-table-page-1.png`, `12-table-page-2.png` |
| Empty state and first-run warning | `03-empty-state.png` |
| Create (form, validation, confirm, progress) | `06`–`10` |
| Details and checks | `15-details.png`, `17-details-verify-and-test-restore.png` |
| Download (password) | `18`–`20` |
| Delete (latest blocked) | `21`, `22` |
| Restore (warnings, wrong password, progress, done) | `23`–`26` |
| Activity log and CSV filter | `27`, `28` |
| Stale warning, 30-backup limit | `29`–`31` |
| Errors | `32`, `33` |
| Narrow screen and tablet | `34`–`37` |
| A role that is not allowed (Manager) has no menu item; Admin has it | `01-manager-has-no-backups-menu.png`, `02-admin-menu.png` |

## Known limits

- **Not run against Supabase**, by design. Compatibility was reviewed in code and simulated (direct URL rules, extension in an `extensions` schema, role without `CREATEDB`); the real project must be checked with the Supabase checklist in the docs.
- The real tests used PostgreSQL **17.6**. The Supabase major version was not available to me; the server's `pg_dump` must be at least as new as it.
- `docker-compose.backup-test.yml` was written on a machine without Docker and has **not been executed**. The suites themselves ran natively.
- MinIO itself was not tested (replaced by rclone's S3 server). Multipart behaviour was verified there and with a fake client, not on AWS S3.
- Single backend instance only (job lock, maintenance mode and download tokens are in process memory); cluster mode is refused.
- No 2FA exists in the portal, so the password is the second check. Accounts without a password (passkey-only) cannot confirm a download or restore.
- A restore returns staff accounts and sessions to the backed-up state, so the person restoring may be signed out.
- The backup file for "Database + files" may be large; the temporary working folder needs roughly twice the database size.
- The nightly GitHub workflow `.github/workflows/db-backup.yml` is untouched and still runs.

## Open decisions (for the supervisor)

1. **Nightly workflow:** keep or remove `.github/workflows/db-backup.yml`? It contradicts "manual only" and stores database dumps as GitHub artifacts.
2. **Customer-document bucket:** turn on `BACKUP_INCLUDE_SUPABASE_STORAGE`? Backups become larger and contain NIC images (already encrypted by the portal, and encrypted again).
3. **Encryption keys:** where are `BACKUP_ENCRYPTION_KEY` and `DOCUMENT_ENCRYPTION_KEY` kept outside the server, and who holds them?
4. **Supabase access:** is the direct connection (port 5432, IPv6 or IPv4 add-on) available from the server, and can the database user have `CREATEDB` (or is a separate test-restore server provided)?
5. **Which roles may use backups in production** (`BACKUP_ALLOWED_ROLES`: all Admins by default, or fewer), and who may restore.
6. **Backup storage:** local folder or S3 bucket, and the retention policy beyond 30 backups.

## Merge notes

- Apply `db/migrations/2026-11-19-backups.sql` before using the feature (it is safe to repeat).
- Follow [BACKUP_DEPLOYMENT_CHECKLIST.md](BACKUP_DEPLOYMENT_CHECKLIST.md). Deploying the branch does not apply the migration or enable anything: with no `BACKUP_ENCRYPTION_KEY` the feature refuses to run.
- No existing endpoint changes behaviour: the earlier Super Admin special cases were removed again, so User Management and the other admin routes behave exactly as before this feature.
- Apply `db/migrations/2026-11-21-remove-super-admin.sql` on any database that ran the first version of this branch (it only changes rows if a "Super Admin" user exists).
