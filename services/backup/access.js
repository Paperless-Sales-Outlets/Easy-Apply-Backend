// Who may use the Backup Dashboard: the roles listed in BACKUP_ALLOWED_ROLES.
//
//   BACKUP_ALLOWED_ROLES=Admin              (default)
//   BACKUP_ALLOWED_ROLES=Admin,Manager      (comma-separated; case and extra spaces are ignored)
//
// An account may use backups when its role is in the list and it is active. Customers can
// never use them, whatever the list says. This is enforced on the server for every backup
// endpoint (requireBackupAccess); the frontend only asks the server whether to show the page.

export const DEFAULT_BACKUP_ROLES = ['Admin'];

const normalize = (role) => String(role ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** The configured roles, as written; falls back to ["Admin"] when the setting is missing or empty. */
export function getBackupAllowedRoles(env = process.env) {
  const listed = String(env.BACKUP_ALLOWED_ROLES ?? '')
    .split(',')
    .map((role) => role.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  return listed.length ? listed : [...DEFAULT_BACKUP_ROLES];
}

/** True when this signed-in account may use every backup feature. */
export function canUseBackups(account, env = process.env) {
  if (!account || account.isActive === false) return false;
  const role = normalize(account.role);
  if (!role || role === 'customer') return false;
  return getBackupAllowedRoles(env).some((allowed) => normalize(allowed) === role);
}
