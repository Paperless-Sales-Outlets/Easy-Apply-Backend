import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createBackupRouter } from '../routes/admin/backupRoutes.js';
import { requireBackupAccess, authorize, requirePrivilege } from '../middleware/authMiddleware.js';
import { canUseBackups, getBackupAllowedRoles } from '../services/backup/access.js';

// Access control for the Backup Dashboard API: only the roles in BACKUP_ALLOWED_ROLES
// (default: Admin) may use it. The router is built with a fake authenticator and stub
// handlers, so no database is touched. Routes are discovered from the router itself, so a
// newly added endpoint is covered automatically — and fails here if it is not guarded.

const UUID = '3f2b8c1e-5d4a-4e6b-9a7c-1b2d3e4f5a6b';
const USER_ID = '00000000-0000-4000-8000-000000000001';

const fakeAuthenticate = (req, res, next) => {
  const role = req.headers['x-test-role'];
  if (!role) {
    res.status(401);
    return next(new Error('Not authorized, no token provided'));
  }
  req.user = { _id: USER_ID, name: 'Test User', role, isActive: req.headers['x-test-inactive'] !== '1' };
  next();
};

const passThroughDb = (req, res, next) => next();

const HANDLER_NAMES = [
  'getAccess', 'getSummary', 'getSettings', 'getAuditLog', 'exportAudit', 'downloadFile', 'listBackups',
  'createBackup', 'getBackup', 'deleteBackup', 'verifyBackup', 'testRestore', 'restoreBackup', 'createDownloadLink',
];
// Stand-ins for the real handlers: reaching one means the access check let the request through.
const stubHandlers = Object.fromEntries(
  HANDLER_NAMES.map((name) => [name, (req, res) => (name === 'getAccess' ? res.json({ allowed: true }) : res.status(200).json({ reached: name }))])
);

function listRoutes(router) {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods).map((method) => ({
        method: method.toUpperCase(),
        path: layer.route.path.replace(':id', UUID).replace(':token', 'sometoken'),
        pattern: layer.route.path,
      }))
    );
}

const ENV_KEY = 'BACKUP_ALLOWED_ROLES';

describe('Backup API is limited to BACKUP_ALLOWED_ROLES', () => {
  let server;
  let base;
  let routes;
  let guarded;
  const saved = process.env[ENV_KEY];

  before(async () => {
    const router = createBackupRouter({ authenticate: fakeAuthenticate, database: passThroughDb, handlers: stubHandlers });
    routes = listRoutes(router);
    guarded = routes.filter((route) => route.pattern !== '/access');
    const app = express();
    app.use(express.json());
    app.use('/api/admin/backups', router);
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, _next) => res.status(res.statusCode >= 400 ? res.statusCode : 500).json({ message: err.message }));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/admin/backups`;
  });

  after(() => {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
    return new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    delete process.env[ENV_KEY]; // default: Admin only
  });

  const call = (route, headers = {}) =>
    fetch(base + (route.path === '/' ? '' : route.path), {
      method: route.method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: ['POST', 'PUT', 'PATCH'].includes(route.method) ? '{}' : undefined,
    });

  // every guarded endpoint, as a status per role
  const statuses = async (role, extra = {}) => {
    const out = {};
    for (const route of guarded) out[`${route.method} ${route.pattern}`] = (await call(route, { 'x-test-role': role, ...extra })).status;
    return out;
  };
  const allStatus = async (role, expected, extra) => {
    for (const [route, status] of Object.entries(await statuses(role, extra))) assert.equal(status, expected, `${role}: ${route} returned ${status}`);
  };

  test('discovers every endpoint (so none can be missed)', () => {
    const found = routes.map((r) => `${r.method} ${r.pattern}`).sort();
    assert.deepEqual(found, [
      'DELETE /:id',
      'GET /',
      'GET /:id',
      'GET /access',
      'GET /audit',
      'GET /audit/export',
      'GET /downloads/:token',
      'GET /settings',
      'GET /summary',
      'POST /',
      'POST /:id/download-link',
      'POST /:id/restore',
      'POST /:id/test-restore',
      'POST /:id/verify',
    ]);
  });

  test('Admin can use every backup endpoint', async () => {
    await allStatus('Admin', 200);
  });

  test('the role match ignores case and extra spaces', async () => {
    await allStatus('admin', 200);
    await allStatus('  ADMIN ', 200);
  });

  for (const role of ['Staff', 'Manager', 'Sales Officer', 'Customer', 'Field Technician', 'Super Admin', 'Administrator', 'Admin Assistant', 'Adm']) {
    test(`${role} gets 403 on every endpoint by default`, async () => {
      await allStatus(role, 403);
      const res = await call(guarded[0], { 'x-test-role': role });
      assert.match((await res.json()).message, /do not have access to the Backup Dashboard/);
    });
  }

  test('an unauthenticated caller gets 401 on every endpoint, including /access', async () => {
    for (const route of routes) {
      const res = await call(route);
      assert.equal(res.status, 401, `${route.method} ${route.pattern} returned ${res.status}`);
    }
  });

  test('a deactivated Admin is refused', async () => {
    await allStatus('Admin', 403, { 'x-test-inactive': '1' });
  });

  test('a token in the query string is refused before authentication', async () => {
    const res = await fetch(`${base}/summary?token=abc`, { headers: { 'x-test-role': 'Admin' } });
    assert.equal(res.status, 400);
  });

  test('a malformed backup id is a 404, not a server error', async () => {
    const res = await fetch(`${base}/not-a-uuid`, { headers: { 'x-test-role': 'Admin' } });
    assert.equal(res.status, 404);
  });

  describe('GET /access (what the frontend asks before showing the menu item)', () => {
    // The real answer comes from the controller; here the stub always says true, so this
    // checks the route is reachable by every signed-in role but never without a login.
    test('answers every signed-in role, and nobody who is signed out', async () => {
      const route = routes.find((r) => r.pattern === '/access');
      for (const role of ['Admin', 'Staff', 'Customer']) assert.equal((await call(route, { 'x-test-role': role })).status, 200, role);
      assert.equal((await call(route)).status, 401);
    });
  });

  describe('BACKUP_ALLOWED_ROLES', () => {
    test('more than one role can be allowed', async () => {
      process.env[ENV_KEY] = 'Admin,Manager';
      await allStatus('Admin', 200);
      await allStatus('Manager', 200);
      await allStatus('Staff', 403);
      await allStatus('Customer', 403);
    });

    test('a role that is not Admin can be the only one allowed — and Admin is then refused', async () => {
      process.env[ENV_KEY] = 'Manager';
      await allStatus('Manager', 200);
      await allStatus('Admin', 403);
    });

    test('spaces, case and empty entries are ignored', async () => {
      process.env[ENV_KEY] = '  admin , MANAGER ,, sales   officer ';
      await allStatus('Admin', 200);
      await allStatus('Manager', 200);
      await allStatus('Sales Officer', 200);
      await allStatus('Staff', 403);
    });

    test('an empty or blank value falls back to Admin only', async () => {
      for (const value of ['', '   ', ' , , ']) {
        process.env[ENV_KEY] = value;
        await allStatus('Admin', 200);
        await allStatus('Manager', 403);
      }
    });

    test('Customer is never allowed, even if it is listed', async () => {
      process.env[ENV_KEY] = 'Admin,Customer';
      await allStatus('Customer', 403);
      await allStatus('Admin', 200);
    });

    test('the list is read on every request, so a restart is the only thing needed after editing .env', async () => {
      process.env[ENV_KEY] = 'Manager';
      await allStatus('Manager', 200);
      process.env[ENV_KEY] = 'Admin';
      await allStatus('Manager', 403);
    });
  });
});

describe('access helpers', () => {
  test('getBackupAllowedRoles: default, list, trimming', () => {
    assert.deepEqual(getBackupAllowedRoles({}), ['Admin']);
    assert.deepEqual(getBackupAllowedRoles({ BACKUP_ALLOWED_ROLES: 'Admin' }), ['Admin']);
    assert.deepEqual(getBackupAllowedRoles({ BACKUP_ALLOWED_ROLES: ' Admin , Team  Lead ,' }), ['Admin', 'Team Lead']);
    assert.deepEqual(getBackupAllowedRoles({ BACKUP_ALLOWED_ROLES: '' }), ['Admin']);
  });

  test('canUseBackups: role in the list and active', () => {
    const env = { BACKUP_ALLOWED_ROLES: 'Admin,Team Lead' };
    assert.equal(canUseBackups({ role: 'Admin' }, env), true);
    assert.equal(canUseBackups({ role: 'team  lead' }, env), true);
    assert.equal(canUseBackups({ role: 'Staff' }, env), false);
    assert.equal(canUseBackups({ role: 'Admin', isActive: false }, env), false);
    assert.equal(canUseBackups({ role: 'Customer' }, { BACKUP_ALLOWED_ROLES: 'Customer' }), false);
    assert.equal(canUseBackups({}, env), false);
    assert.equal(canUseBackups(null, env), false);
    assert.equal(canUseBackups({ role: 'Admin' }, {}), true, 'default is Admin');
  });
});

describe('requireBackupAccess and the existing role helpers', () => {
  const run = (middleware, user) =>
    new Promise((resolve) => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };
      middleware({ user }, res, (error) => resolve({ error, status: res.statusCode }));
    });

  test('requireBackupAccess lets Admin through and answers 401 without a user', async () => {
    const saved = process.env.BACKUP_ALLOWED_ROLES;
    delete process.env.BACKUP_ALLOWED_ROLES;
    try {
      assert.equal((await run(requireBackupAccess, { role: 'Admin', isActive: true })).error, undefined);
      assert.equal((await run(requireBackupAccess, { role: 'Staff', isActive: true })).status, 403);
      assert.equal((await run(requireBackupAccess, undefined)).status, 401);
    } finally {
      if (saved !== undefined) process.env.BACKUP_ALLOWED_ROLES = saved;
    }
  });

  test('there is no special "Super Admin" role any more: it gets no extra access anywhere', async () => {
    assert.equal((await run(authorize('admin'), { role: 'Super Admin' })).status, 403);
    assert.equal((await run(requirePrivilege('kyc'), { role: 'Super Admin', permissions: [] })).status, 403);
    assert.equal((await run(authorize('admin'), { role: 'Admin' })).error, undefined);
    assert.equal((await run(requirePrivilege('kyc'), { role: 'Admin', permissions: [] })).error, undefined);
  });
});
