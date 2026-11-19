import User from '../../models/User.js';
import { lockRemaining, recordFailure, clearFailures } from '../../utils/loginThrottle.js';
import { BackupError } from './errors.js';

// Re-checks the signed-in Super Admin's password before a download or restore.
// Wrong answers are throttled with the same limiter as sign-in (5 tries, then a
// 15-minute lock). The portal has no TOTP 2FA, so the password is the second step.
//
// NOTE: the status for a wrong password is 403, never 401 — the admin client
// treats 401 as "session expired" and would sign the user out.

export async function verifyActorPassword(account, password) {
  const key = `backup-reauth:${account?._id || account?.id}`;

  const lockedFor = lockRemaining(key);
  if (lockedFor > 0) {
    throw new BackupError(
      `Too many incorrect passwords. Try again in ${Math.ceil(lockedFor / 60)} minute(s).`,
      429,
      'PASSWORD_LOCKED'
    );
  }
  if (typeof password !== 'string' || !password) {
    throw new BackupError('Enter your password to continue.', 400, 'PASSWORD_REQUIRED');
  }

  const user = await User.findById(account._id || account.id).select('+password');
  if (!user || !(user.passwordHash || user.password)) {
    throw new BackupError(
      'Your account has no password set, so it cannot confirm this action. Ask an administrator to set one.',
      400,
      'NO_PASSWORD'
    );
  }
  if (!(await user.matchPassword(password))) {
    const { locked } = recordFailure(key);
    throw new BackupError(
      locked ? 'Too many incorrect passwords. Try again in 15 minutes.' : 'Incorrect password.',
      locked ? 429 : 403,
      locked ? 'PASSWORD_LOCKED' : 'PASSWORD_INCORRECT'
    );
  }
  clearFailures(key);
}
