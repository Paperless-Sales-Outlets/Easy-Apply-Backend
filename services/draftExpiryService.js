import mongoose from 'mongoose';
import NewConnectionDraft, { DRAFT_LIFETIME_MS, DRAFT_STATUS } from '../models/NewConnectionDraft.js';

// Unfinished New Connection applications can be continued for 30 days from
// when they were started. After that they are marked `expired`: hidden from
// the customer and no longer continuable, but kept in the database (with their
// photos) so they can still be retrieved. Nothing here deletes a draft.

/**
 * One-time upgrade of the drafts collection, safe to run on every start.
 *
 * Earlier versions deleted drafts automatically (a TTL index on `expiresAt`)
 * and allowed one draft per number in total (a plain unique index on `phone`).
 * Both must go: the first would keep deleting drafts that should now be kept,
 * the second would stop a customer starting again after a draft expired.
 * Drafts saved before statuses existed become active, with their 30 days
 * counted from when they were started.
 */
export async function prepareDraftStorage() {
  if (mongoose.connection.readyState !== 1) return;

  const collection = mongoose.connection.collection(NewConnectionDraft.collection.collectionName);
  const indexes = await collection.indexes().catch(() => []); // collection may not exist yet

  for (const index of indexes) {
    const autoDelete = index.expireAfterSeconds !== undefined;
    const oneDraftPerNumber = index.key?.phone === 1 && index.unique && !index.partialFilterExpression;
    if (autoDelete || oneDraftPerNumber) {
      await collection.dropIndex(index.name);
      console.log(`[drafts] removed old index ${index.name}`);
    }
  }

  const upgraded = await collection.updateMany({ status: { $exists: false } }, [
    {
      $set: {
        status: DRAFT_STATUS.ACTIVE,
        resumeUntil: { $add: [{ $ifNull: ['$createdAt', '$$NOW'] }, DRAFT_LIFETIME_MS] },
        expiredAt: null,
      },
    },
    { $unset: 'expiresAt' },
  ]);
  if (upgraded.modifiedCount) {
    console.log(`[drafts] set status and 30-day limit on ${upgraded.modifiedCount} existing draft(s)`);
  }

  // Build the current indexes (one active draft per number, expiry lookup)
  // now that any conflicting old ones are gone.
  await NewConnectionDraft.createIndexes();
}

/** Mark every active draft past its 30 days as expired. Returns how many. */
export async function runDraftExpiry() {
  if (mongoose.connection.readyState !== 1) return 0;

  const result = await NewConnectionDraft.updateMany(
    { status: DRAFT_STATUS.ACTIVE, resumeUntil: { $lte: new Date() } },
    { $set: { status: DRAFT_STATUS.EXPIRED, expiredAt: new Date() } }
  );
  if (result.modifiedCount) {
    console.log(`[drafts] marked ${result.modifiedCount} draft(s) as expired`);
  }
  return result.modifiedCount;
}

/**
 * Prepare the collection once the database is connected, then mark expired
 * drafts straight away and every hour after.
 */
export function startDraftExpiryScheduler(intervalMs = 60 * 60 * 1000) {
  const tick = () => runDraftExpiry().catch((err) => console.error('[drafts] expiry sweep failed:', err.message));

  const start = () =>
    prepareDraftStorage()
      .catch((err) => console.error('[drafts] storage upgrade failed:', err.message))
      .finally(tick);

  if (mongoose.connection.readyState === 1) start();
  else mongoose.connection.once('open', start);

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return timer;
}
