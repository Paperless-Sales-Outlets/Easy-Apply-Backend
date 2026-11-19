import { isDbConnected, query } from '../config/db.js';
import { DRAFT_STATUS } from '../models/NewConnectionDraft.js';
import { deleteFile, extractStorageKey } from './storageService.js';

// Unfinished New Connection applications never expire. A draft is kept until
// the customer submits the application or discards the draft, so they can
// resume it any time.

const DRAFT_PHOTO_FOLDER = 'drafts/';

/**
 * True when a stored file is still referenced outside the draft. A restored
 * draft submits its photo URLs as-is, so a submitted application (or the
 * customer's saved identity documents) can point at a file in `drafts/`.
 */
async function isPhotoInUse(key) {
  const pattern = `%${key}%`;
  const { rows } = await query(
    `SELECT
       EXISTS (SELECT 1 FROM applications
               WHERE documents::text LIKE $1 OR form_data::text LIKE $1)
       OR EXISTS (SELECT 1 FROM customers
                  WHERE identity_documents::text LIKE $1) AS in_use`,
    [pattern]
  );
  return Boolean(rows[0]?.in_use);
}

/**
 * Delete draft photo files from storage. Only touches files in the `drafts/`
 * folder that nothing else references. Never throws.
 */
export async function deleteDraftPhotoFiles(refs = []) {
  let deleted = 0;
  for (const ref of refs) {
    try {
      const key = extractStorageKey(ref);
      if (!key || !key.startsWith(DRAFT_PHOTO_FOLDER)) continue;
      if (await isPhotoInUse(key)) continue;
      await deleteFile(key);
      deleted += 1;
    } catch (err) {
      console.warn('[drafts] photo cleanup notice:', err.message);
    }
  }
  return deleted;
}

/**
 * Startup tidy-up of the drafts table:
 *  - drafts with no status become active
 *  - drafts marked expired under the old 30-day rule become resumable again
 *    (the latest one per phone, and only if that phone has no active draft,
 *    since a phone can hold one active draft at a time)
 */
export async function prepareDraftStorage() {
  if (!isDbConnected()) return;
  try {
    await query(
      `UPDATE new_connection_drafts
       SET status = $1
       WHERE status IS NULL`,
      [DRAFT_STATUS.ACTIVE]
    );

    const revived = await query(
      `UPDATE new_connection_drafts d
       SET status = $1, expired_at = NULL, updated_at = NOW()
       WHERE d.status = $2
         AND d.id = (SELECT x.id FROM new_connection_drafts x
                     WHERE x.phone = d.phone AND x.status = $2
                     ORDER BY x.updated_at DESC NULLS LAST
                     LIMIT 1)
         AND NOT EXISTS (SELECT 1 FROM new_connection_drafts a
                         WHERE a.phone = d.phone AND a.status = $1)`,
      [DRAFT_STATUS.ACTIVE, DRAFT_STATUS.EXPIRED]
    );
    if (revived.rowCount > 0) {
      console.log(`[drafts] made ${revived.rowCount} previously expired draft(s) resumable again`);
    }
  } catch (err) {
    console.warn('[drafts] storage prep notice:', err.message);
  }
}

/**
 * Runs the startup tidy-up once the database is connected. There is no
 * expiry sweep any more. (Name kept because server.js calls it.)
 */
export function startDraftExpiryScheduler() {
  const waitForDb = () => {
    if (!isDbConnected()) {
      setTimeout(waitForDb, 5000).unref?.();
      return;
    }
    prepareDraftStorage().catch((err) =>
      console.error('[drafts] storage prep failed:', err.message));
  };
  setTimeout(waitForDb, 2000).unref?.();
}
