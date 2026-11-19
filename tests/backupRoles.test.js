import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createBackupRouter } from '../routes/admin/backupRoutes.js';
import { requireSuperAdmin, authorize, requirePrivilege, isSuperAdmin } from '../middleware/authMiddleware.js';

// Role checks for the Backup Dashboard API. The router is built with a fake
// authenticator (so no database is needed): it reads the caller's role from a
// test header. The routes are discovered from the router itself, so a newly
// added endpoint is covered automatically — and fails here if it is not guarded.

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

describe('Backup API is Super Admin only', () => {
  let server;
  let base;
  let routes;

  before(async () => {
    const router = createBackupRouter({ authenticate: fakeAuthenticate, database: passThroughDb });
    routes = listRoutes(router);
    const app = express();
    app.use(express.json());
    app.use('/api/admin/backups', router);
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, _next) => res.status(res.statusCode >= 400 ? res.statusCode : 500).json({ message: err.message }));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/admin/backups`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  const call = (route, headers = {}) =>
    fetch(base + (route.path === '/' ? '' : route.path), {
      method: route.method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: ['POST', 'PUT', 'PATCH'].includes(route.method) ? '{}' : undefined,
    });

  test('discovers every endpoint (so none can be missed)', () => {
    const found = routes.map((r) => `${r.method} ${r.pattern}`).sort();
    assert.deepEqual(found, [
      'DELETE /:id',
      'GET /',
      'GET /:id',
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

  for (const role of ['Admin', 'Staff', 'Manager', 'Sales Officer', 'Customer', 'Field Technician', 'Super Admin Jr', 'super-admin']) {
    test(`${role} gets 403 on every endpoint`, async () => {
      for (const route of routes) {
        const res = await call(route, { 'x-test-role': role });
        assert.equal(res.status, 403, `${role}: ${route.method} ${route.pattern} returned ${res.status}`);
        const body = await res.json();
        assert.match(body.message, /Super Admin/);
      }
    });
  }

  test('an unauthenticated caller gets 401 on every endpoint', async () => {
    for (const route of routes) {
      const res = await call(route);
      assert.equal(res.status, 401, `${route.method} ${route.pattern} returned ${res.status}`);
    }
  });

  test('a deactivated Super Admin is refused', async () => {
    for (const route of routes) {
      const res = await call(route, { 'x-test-role': 'Super Admin', 'x-test-inactive': '1' });
      assert.equal(res.status, 403, `${route.method} ${route.pattern} returned ${res.status}`);
    }
  });

  test('a token in the query string is refused before authentication', async () => {
    const res = await fetch(`${base}/summary?token=abc`, { headers: { 'x-test-role': 'Super Admin' } });
    assert.equal(res.status, 400);
  });

  test('a malformed backup id is a 404, not a server error', async () => {
    const res = await fetch(`${base}/not-a-uuid`, { headers: { 'x-test-role': 'Super Admin' } });
    assert.equal(res.status, 404);
  });
});

describe('Super Admin role helpers', () => {
  const run = (middleware, user) =>
    new Promise((resolve) => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };
      middleware({ user }, res, (error) => resolve({ error, status: res.statusCode }));
    });

  test('requireSuperAdmin lets a Super Admin through, in any letter case', async () => {
    for (const role of ['Super Admin', 'super admin', ' SUPER ADMIN ']) {
      const { error } = await run(requireSuperAdmin, { role, isActive: true });
      assert.equal(error, undefined, role);
    }
  });

  test('requireSuperAdmin blocks Admin and answers 401 without a user', async () => {
    assert.equal((await run(requireSuperAdmin, { role: 'Admin', isActive: true })).status, 403);
    assert.equal((await run(requireSuperAdmin, undefined)).status, 401);
  });

  test('isSuperAdmin is false for look-alike roles', () => {
    assert.equal(isSuperAdmin({ role: 'Admin' }), false);
    assert.equal(isSuperAdmin({ role: 'Super Administrator' }), false);
    assert.equal(isSuperAdmin({ role: 'Super Admin', isActive: false }), false);
    assert.equal(isSuperAdmin({ role: 'Super Admin' }), true);
  });

  test('a Super Admin keeps every Admin permission', async () => {
    assert.equal((await run(authorize('admin'), { role: 'Super Admin' })).error, undefined);
    assert.equal((await run(requirePrivilege('kyc'), { role: 'Super Admin', permissions: [] })).error, undefined);
    assert.equal((await run(authorize('admin'), { role: 'Staff' })).status, 403);
  });
});
