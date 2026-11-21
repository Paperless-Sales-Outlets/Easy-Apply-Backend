import express from 'express';
import * as controller from '../../controllers/admin/backupController.js';
import { protect, requireBackupAccess } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { rejectInvalidId, rejectInvalidDates } from '../../middleware/adminParamsMiddleware.js';

// Backup Dashboard API — only the roles in BACKUP_ALLOWED_ROLES (default: Admin).
//
// The `router.use(requireBackupAccess)` below runs for every route declared after it, so a new
// endpoint cannot be added without the role check: anyone else gets 403. The only route above
// the guard is GET /access, which just tells the frontend whether to show the page.

// Backup endpoints never accept a token in the URL (protect() would otherwise allow ?token=).
const rejectQueryToken = (req, res, next) => {
  if (req.query && 'token' in req.query) {
    return res.status(400).json({ success: false, message: 'Tokens must be sent in the Authorization header.' });
  }
  next();
};

const noStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

/** `authenticate`, `database` and `handlers` are injectable so tests can exercise the role checks without a database. */
export function createBackupRouter({ authenticate = protect, database = requireDb, handlers = controller } = {}) {
  const router = express.Router();

  router.use(noStore, rejectQueryToken, database, authenticate);

  // Any signed-in user may ask whether they have access; the answer is only true / false.
  router.get('/access', handlers.getAccess);

  // Everything below: only the roles in BACKUP_ALLOWED_ROLES.
  router.use(requireBackupAccess);
  router.use(rejectInvalidDates);
  router.param('id', rejectInvalidId('Backup'));

  // Dashboard data
  router.get('/summary', handlers.getSummary);
  router.get('/settings', handlers.getSettings);
  router.get('/audit', handlers.getAuditLog);
  router.get('/audit/export', handlers.exportAudit);

  // Single-use download link target (also requires the bearer token)
  router.get('/downloads/:token', handlers.downloadFile);

  // Backups
  router.get('/', handlers.listBackups);
  router.post('/', handlers.createBackup);
  router.get('/:id', handlers.getBackup);
  router.delete('/:id', handlers.deleteBackup);
  router.post('/:id/verify', handlers.verifyBackup);
  router.post('/:id/test-restore', handlers.testRestore);
  router.post('/:id/restore', handlers.restoreBackup);
  router.post('/:id/download-link', handlers.createDownloadLink);

  return router;
}

export default createBackupRouter();
