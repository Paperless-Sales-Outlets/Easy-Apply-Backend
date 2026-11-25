# Backup feature: server deployment checklist

Do these steps on the real server, in order. Every step has a command to check it. Nothing here should be run against production until your supervisor has approved the open decisions in [PR_DESCRIPTION_BACKUP.md](PR_DESCRIPTION_BACKUP.md).

Replace `<APP>` with the backend folder (`~/paperless_project/Easy-Apply-Backend`) and run the commands as the user that runs the backend.

## 0. Before you start

- [ ] The pull request is merged and the backend is deployed (`git log -1` in `<APP>` shows the backup commits).
- [ ] You know the PostgreSQL **major version** of the database (Supabase: Dashboard, Database, Settings).
- [ ] The decisions are made: where the encryption key is kept, whether the document bucket is included, the fate of the nightly GitHub workflow.

## 1. Install the PostgreSQL client tools (version check)

Install `postgresql-client-<N>` where `<N>` is **equal to or newer than** the database's major version, plus `tar`.

```bash
sudo apt-get update && sudo apt-get install -y postgresql-client-17 tar
```

Check:
```bash
pg_dump --version && pg_restore --version && tar --version | head -1
# the pg_dump major version must be >= the database server's major version
psql "$BACKUP_DATABASE_URL" -tAc "SHOW server_version"      # run after step 3
```
If the tools are not on the PATH, set `PG_DUMP_PATH` and `PG_RESTORE_PATH` (step 3).

## 2. Create the storage location

**Local folder (default):**
```bash
sudo mkdir -p /var/backups/slt-easyapply
sudo chown <service-user>:<service-user> /var/backups/slt-easyapply
sudo chmod 700 /var/backups/slt-easyapply
```
Check: `ls -ld /var/backups/slt-easyapply` shows `drwx------` and the service user as owner. The folder must be outside the project and the web root, and on a disk with space for 30 backups plus the working space in step 3.

**S3-compatible bucket instead:** create a private bucket and a dedicated access key that can read, write and delete only that bucket. Check with your S3 client (for example `aws s3 ls s3://<bucket> --endpoint-url <url>`).

## 3. Environment variables

Edit the server's `.env` (never commit it). Documented in `.env.example`; at least:

```
BACKUP_STORAGE=local
BACKUP_LOCAL_PATH=/var/backups/slt-easyapply
BACKUP_ENCRYPTION_KEY=<64 hex characters>
BACKUP_DATABASE_URL=postgresql://<user>:<password>@<direct-host>:5432/<db>?sslmode=require
BACKUP_MAX_COUNT=30
BACKUP_ALLOWED_ROLES=Admin
BACKUP_WARNING_DAYS=7
TRUST_PROXY=1
# optional: BACKUP_TEST_RESTORE_URL, BACKUP_TMP_DIR, PG_DUMP_PATH, PG_RESTORE_PATH
# optional and OFF by default: BACKUP_INCLUDE_SUPABASE_STORAGE=true and BACKUP_SUPABASE_BUCKETS
```

- **Encryption key:** generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Immediately store a copy outside the server** (company password manager or vault). Without it no backup can be restored.
- **`BACKUP_ALLOWED_ROLES`:** the roles that may use backups, comma-separated (default `Admin`). In production, restrict access by changing this value and restarting the backend.
- **Database URL for backups:** a session connection on port **5432** (direct host, or the session pooler host), never port 6543.
- **`TRUST_PROXY=1`** so the activity log records real client IPs behind nginx.

Checks (the key and password are never printed):
```bash
cd <APP>
node -e "const k=(process.env.BACKUP_ENCRYPTION_KEY||'');console.log('key length',k.length,/^[0-9a-f]{64}\$/i.test(k)?'OK':'INVALID')" 
set -a; . ./.env; set +a
node -e "const u=new URL(process.env.BACKUP_DATABASE_URL);console.log(u.hostname,u.port, u.port==='5432'?'session connection OK':'NOT port 5432')"
psql "$BACKUP_DATABASE_URL" -tAc "select current_database(), current_user"
```

## 4. The CREATEDB privilege (for Test restore)

```bash
psql "$BACKUP_DATABASE_URL" -tAc "select rolcreatedb from pg_roles where rolname = current_user"
```
- `t`: nothing to do.
- `f`: ask the database administrator to grant it (`ALTER ROLE <user> CREATEDB;`), **or** set `BACKUP_TEST_RESTORE_URL` to a separate PostgreSQL server where a temporary database may be created, and run the same check against that URL. Verify integrity works either way.

Also confirm the Supabase items in the "Supabase checklist" of [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md#supabase-checklist-confirm-on-the-real-project) (extensions, IPv4/IPv6, RLS).

## 5. Run as a single backend instance

```bash
cd <APP>
pm2 start ecosystem.config.cjs      # or: pm2 reload ecosystem.config.cjs --update-env
pm2 save
```
Check:
```bash
pm2 describe easy-apply-backend-backup | grep -E "exec mode|instances|status"   # fork, 1, online
pm2 logs easy-apply-backend-backup --lines 50 --nostream | grep -i "SINGLE backend instance" || echo "no multi-instance warning"
```

## 6. Apply the database migration

Back up first if you can (Supabase dashboard backup). The backup migration creates the backup tables, the audit migration copies historical backup activity into `audit_logs` without deleting the originals, and the role migration turns any old "Super Admin" user into a normal Admin. These migrations are safe to repeat.

```bash
cd <APP>
set -a; . ./.env; set +a
psql "$BACKUP_DATABASE_URL" -f db/migrations/2026-11-19-backups.sql
psql "$BACKUP_DATABASE_URL" -f db/migrations/2026-11-25-centralize-backup-audit.sql
psql "$BACKUP_DATABASE_URL" -f db/migrations/2026-11-21-remove-super-admin.sql
```
Check:
```bash
psql "$BACKUP_DATABASE_URL" -tAc "select to_regclass('public.backups'), to_regclass('public.backup_audit_logs'), to_regclass('public.audit_logs')"
# all three names must be printed (not empty)
psql "$BACKUP_DATABASE_URL" -tAc "select count(*) from users where role ilike 'super admin'"
# must print 0
```

## 7. Restart the backend and check who can see Backups

```bash
pm2 restart easy-apply-backend-backup --update-env
curl -s http://127.0.0.1:5050/api/health                 # "dbConnected":true
```
There is no account to create: with the default `BACKUP_ALLOWED_ROLES=Admin`, any Admin can use backups.

Check: an Admin signs in and sees **Backups** in the menu (Administration section). A user whose role is not in `BACKUP_ALLOWED_ROLES` (for example Staff) must **not** see it, and gets 403 from `/api/admin/backups/summary`.

## 8. First real backup, verify, test restore

In the portal, as an allowed user (an Admin by default), open **Backups**, then the **Storage & retention** tab, and confirm every line under "Server readiness" is green: encryption key configured, direct database connection, single instance, `pg_dump` and `pg_restore` found.

1. **Create backup** (type "Full database", note "First backup after setup"). It must end **Success**.
2. Row menu, **Verify integrity**. It must pass.
3. Row menu, **Test restore**. It must pass, and the row counts in Details must look right.
4. Check on the server:
   ```bash
   ls -l /var/backups/slt-easyapply/*/                                   # one .sltbak file, owner = service user
   psql "$BACKUP_DATABASE_URL" -tAc "select count(*) from pg_database where datname like 'slt_backup_test_%'"   # 0
   ```
5. Optional, once, outside business hours: create a backup, change nothing important, and run a real **Restore** to prove the whole chain. Read the runbook in [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md#restore-runbook) first.
6. Open the **Activity log** tab and confirm every step above was recorded with your name and IP address.

## 9. Housekeeping

- [ ] Copy of `BACKUP_ENCRYPTION_KEY` (and `DOCUMENT_ENCRYPTION_KEY`) stored outside the server; two named people know where.
- [ ] Decision recorded about the nightly GitHub workflow `.github/workflows/db-backup.yml` (it conflicts with "manual only"; it was not changed).
- [ ] A reminder to take and test a backup before every release.
