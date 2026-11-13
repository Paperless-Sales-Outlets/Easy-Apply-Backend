// Limits password guessing on the staff sign-in form.
//
// After MAX_FAILURES wrong passwords for the same email within WINDOW_MS, that
// email can't sign in for LOCK_MS. Counting is per email (not per IP address):
// staff often share one office address, so an IP limit could lock everyone out.
// Unknown emails are counted the same way, so the response never reveals
// whether an account exists.
//
// State is kept in memory: it resets when the server restarts, and each server
// instance keeps its own count.

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;

const attempts = new Map(); // email -> { failures, firstAt, lockedUntil }

const keyFor = (email) => String(email || '').trim().toLowerCase();

/** Seconds left on this email's lock, or 0 when it may try to sign in. */
export function lockRemaining(email, now = Date.now()) {
  const entry = attempts.get(keyFor(email));
  if (!entry?.lockedUntil) return 0;
  if (entry.lockedUntil <= now) {
    attempts.delete(keyFor(email));
    return 0;
  }
  return Math.ceil((entry.lockedUntil - now) / 1000);
}

/** Records a wrong password. Returns { locked, remaining } — locked is true only on the attempt that starts the lock. */
export function recordFailure(email, now = Date.now()) {
  const key = keyFor(email);
  let entry = attempts.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) entry = { failures: 0, firstAt: now, lockedUntil: 0 };
  entry.failures += 1;
  let locked = false;
  if (entry.failures >= MAX_FAILURES) {
    entry.lockedUntil = now + LOCK_MS;
    locked = true;
  }
  attempts.set(key, entry);
  return { locked, remaining: Math.max(0, MAX_FAILURES - entry.failures) };
}

/** A successful sign-in clears the count. */
export function clearFailures(email) {
  attempts.delete(keyFor(email));
}

// Drop stale entries now and then so the map can't grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if ((entry.lockedUntil && entry.lockedUntil <= now) || (!entry.lockedUntil && now - entry.firstAt > WINDOW_MS)) attempts.delete(key);
  }
}, 10 * 60 * 1000).unref();
