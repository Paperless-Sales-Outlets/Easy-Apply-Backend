-- Removes the "Super Admin" role. Backup access is now decided by the BACKUP_ALLOWED_ROLES
-- setting (default: Admin), so the extra role is no longer needed.
--
--   * Anyone who has the role "Super Admin" becomes a normal "Admin".
--   * A staff role named "Super Admin", if one was ever defined, is removed.
--
-- users.role is plain text with no CHECK constraint or enum, so there is no schema change.
-- Do NOT edit 2026-11-19-backups.sql: that migration may already have been applied somewhere.
-- Safe to run more than once; it changes nothing when there is nothing to change.

UPDATE users
   SET role = 'Admin', updated_at = NOW()
 WHERE LOWER(REGEXP_REPLACE(TRIM(role), '\s+', ' ', 'g')) = 'super admin';

DELETE FROM staff_roles
 WHERE LOWER(REGEXP_REPLACE(TRIM(name), '\s+', ' ', 'g')) = 'super admin';
