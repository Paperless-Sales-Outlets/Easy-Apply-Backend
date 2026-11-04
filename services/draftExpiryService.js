import { isDbConnected, query } from '../config/db.js';
import { DRAFT_STATUS } from '../models/NewConnectionDraft.js';

// Unfinished New Connection applications can be continued for 30 days from
// when they were started. After that they are marked `expired`: hidden from
// the customer and no longer continuable, but kept in the database (with their
// photos) so they can still be retrieved. Nothing here deletes a draft.

/**
 * Ensures drafts table state is clean on start.
 */
export async function prepareDraftStorage() {
  if (!isDbConnected()) return;
  try {
    await query(
      `UPDATE new_connection_drafts
       SET status = 'active'
       WHERE status IS NULL`
    );
  } catch (err) {
    console.warn('[drafts] storage prep notice:', err.message);
  }
}

/** Mark every active draft past its 30 days as expired. Returns how many. */
export async function runDraftExpiry() {
  if (!isDbConnected()) return 0;

  try {
    const result = await query(
      `UPDATE new_connection_drafts
       SET status = $1, expired_at = NOW(), updated_at = NOW()
       WHERE status = $2 AND resume_until <= NOW()
       RETURNING id`,
      [DRAFT_STATUS.EXPIRED, DRAFT_STATUS.ACTIVE]
    );

    const count = result.rowCount || 0;
    if (count > 0) {
      console.log(`[drafts] marked ${count} draft(s) as expired`);
    }
    return count;
  } catch (err) {
    console.error('[drafts] expiry sweep error:', err.message);
    return 0;
  }
}

/**
 * Mark expired drafts straight away and every hour after.
 */
export function startDraftExpiryScheduler(intervalMs = 60 * 60 * 1000) {
  const tick = () => runDraftExpiry().catch((err) => console.error('[drafts] expiry sweep failed:', err.message));

  const start = () =>
    prepareDraftStorage()
      .catch((err) => console.error('[drafts] storage upgrade failed:', err.message))
      .finally(tick);

  // Trigger on start after initial delay to ensure DB is initialized
  setTimeout(start, 2000);

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return timer;
}
