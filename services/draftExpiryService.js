import mongoose from 'mongoose';
import NewConnectionDraft, { DRAFT_STATUS } from '../models/NewConnectionDraft.js';

/**
 * One-time upgrade of the drafts collection, safe to run on every start.
 *
 * Earlier versions deleted drafts automatically (a TTL index on `expiresAt`)
 * and allowed one draft per number in total (a plain unique index on `phone`).
 * Both must go: the first would keep deleting drafts that should now be kept,
 * the second would stop a customer starting again after a draft expired.
 * Drafts saved before statuses existed are normalized to active. Legacy
 * expired records remain readable by the draft controller without expiry enforcement.
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
      },
    },
    { $unset: ['expiresAt', 'resumeUntil', 'expiredAt'] },
  ]);
  if (upgraded.modifiedCount) {
    console.log(`[drafts] migrated ${upgraded.modifiedCount} existing draft(s)`);
  }

  await NewConnectionDraft.createIndexes();
}
