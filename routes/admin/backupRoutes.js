import express from 'express';
import * as controller from '../../controllers/admin/backupController.js';
import { protect, requireSuperAdmin } from '../../middleware/authMiddleware.js';
import { requireDb } from '../../middleware/dbMiddleware.js';
import { rejectInvalidId, rejectInvalidDates } from '../../middleware/adminParamsMiddleware.js';

// Backup Dashboard API — SUPER ADMIN ONLY.
//
// `router.use(...)` below runs for EVERY route in this file, so a new endpoint
// cannot be added without the Super Admin check. Non-Super-Admin users get 403.

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

/** `authenticate` / `database` are injectable so tests can exercise the role checks without a database. */
export function createBackupRouter({ authenticate = protect, database = requireDb } = {}) {
  const router = express.Router();

  router.use(noStore, rejectQueryToken, database, authenticate, requireSuperAdmin);
  router.use(rejectInvalidDates);
  router.param('id', rejectInvalidId('Backup'));

  // Dashboard data
  router.get('/summary', controller.getSummary);
  router.get('/settings', controller.getSettings);
  router.get('/audit', controller.getAuditLog);
  router.get('/audit/export', controller.exportAudit);

  // Single-use download link target (also requires the bearer token)
  router.get('/downloads/:token', controller.downloadFile);

  // Backups
  router.get('/', controller.listBackups);
  router.post('/', controller.createBackup);
  router.get('/:id', controller.getBackup);
  router.delete('/:id', controller.deleteBackup);
  router.post('/:id/verify', controller.verifyBackup);
  router.post('/:id/test-restore', controller.testRestore);
  router.post('/:id/restore', controller.restoreBackup);
  router.post('/:id/download-link', controller.createDownloadLink);

  return router;
}

export default createBackupRouter();
