// While a restore replaces the database, every other API request is answered
// with 503 so no customer writes land in data that is about to be replaced.
// The backup endpoints and the health check stay reachable so the admin
// can watch the restore finish.

let state = null;

export const enterMaintenance = (reason = 'restore') => {
  state = { reason, since: new Date().toISOString() };
};
export const leaveMaintenance = () => {
  state = null;
};
export const getMaintenance = () => (state ? { ...state } : null);

export const maintenanceGate = (req, res, next) => {
  if (!state) return next();
  const url = req.originalUrl || req.url || '';
  if (url.startsWith('/api/health') || url.startsWith('/api/admin/backups') || req.method === 'OPTIONS') {
    return next();
  }
  res.set('Retry-After', '60');
  return res.status(503).json({
    success: false,
    code: 'MAINTENANCE',
    message: 'The system is being restored from a backup and is temporarily unavailable. Please try again in a few minutes.',
  });
};
