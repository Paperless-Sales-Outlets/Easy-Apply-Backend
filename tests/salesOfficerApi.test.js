import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import User from '../models/User.js';
import Application from '../models/Application.js';
import SalesOfficerQr from '../models/SalesOfficerQr.js';

describe('Sales Officer HTTP Endpoints Integration Test Suite', () => {
  const PORT = process.env.PORT || 5050;
  const BASE_URL = `http://127.0.0.1:${PORT}`;

  let adminToken = '';
  let officerToken = '';
  let officerUser = null;
  let adminUser = null;
  let trackingToken = '';
  const testRefPrefix = `API-TEST-SO-${Date.now()}`;
  const createdAppIds = [];

  before(async () => {
    await connectDB();
    if (mongoose.connection.readyState !== 1) {
      await new Promise((resolve) => mongoose.connection.once('open', resolve));
    }

    // Find or create admin user for test token
    adminUser = await User.findOne({ role: 'Admin' });
    if (!adminUser) {
      adminUser = await User.create({
        name: 'Test Admin',
        email: `admin_${Date.now()}@slt.lk`,
        role: 'Admin',
        password: 'password123',
      });
    }

    // Find officer 095756
    officerUser = await User.findOne({ employeeNumber: '095756' });
    assert.ok(officerUser, 'Sales officer 095756 must exist');

    const secret = process.env.JWT_ACCESS_SECRET || 'your_access_secret_key_change_me_in_production';
    adminToken = jwt.sign({ id: adminUser._id, role: 'Admin' }, secret, { expiresIn: '1h' });
    officerToken = jwt.sign({ id: officerUser._id, role: 'Sales Officer' }, secret, { expiresIn: '1h' });
  });

  after(async () => {
    if (createdAppIds.length > 0) {
      await Application.deleteMany({ _id: { $in: createdAppIds } });
    }
    await mongoose.connection.close();
  });

  // Admin endpoint: GET /api/v1/admin/sales-officers
  test('GET /api/v1/admin/sales-officers returns list of sales officers with role check', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/admin/sales-officers`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.salesOfficers));
    const found = data.salesOfficers.find((o) => o.employeeNumber === '095756');
    assert.ok(found, 'Officer 095756 should be in the list');
    assert.equal(found.role, 'Sales Officer');
  });

  // Unauthorized access check
  test('Admin endpoints reject unauthorized or non-admin requests', async () => {
    // No token
    const resNoToken = await fetch(`${BASE_URL}/api/v1/admin/sales-officers`);
    assert.equal(resNoToken.status, 401);

    // Officer token attempting to access admin route
    const resForbidden = await fetch(`${BASE_URL}/api/v1/admin/sales-officers`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert.equal(resForbidden.status, 403);
  });

  // Admin endpoint: POST /api/v1/admin/sales-officers/:employeeId/qr
  test('POST /api/v1/admin/sales-officers/:employeeId/qr creates or returns existing QR record', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/admin/sales-officers/095756/qr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({}),
    });
    const data = await res.json();

    assert.ok([200, 201].includes(res.status));
    assert.equal(data.success, true);
    assert.ok(data.qr.trackingToken);
    assert.ok(data.qr.qrUrl);
    assert.equal(data.qr.employeeNumber, '095756');

    trackingToken = data.qr.trackingToken;
  });

  // Admin endpoint: GET /api/v1/admin/sales-officers/:employeeId/qr
  test('GET /api/v1/admin/sales-officers/:employeeId/qr retrieves existing QR metadata', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/admin/sales-officers/095756/qr`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.qr.trackingToken, trackingToken);
    assert.equal(data.qr.employeeNumber, '095756');
  });

  // Public tracking endpoint: GET /api/v1/sales-tracking/:token
  test('GET /api/v1/sales-tracking/:token validates token without exposing sensitive data', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/sales-tracking/${trackingToken}`);
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.valid, true);
    assert.equal(data.trackingToken, trackingToken);
    assert.ok(data.portalUrl);

    // Must NOT expose employeeNumber, officer name, email, or customer data
    assert.equal(data.employeeNumber, undefined);
    assert.equal(data.officerName, undefined);
    assert.equal(data.email, undefined);
  });

  // Public tracking endpoint with invalid token
  test('GET /api/v1/sales-tracking/:token rejects invalid token with 404', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/sales-tracking/NON_EXISTENT_TOKEN_9999`);
    const data = await res.json();

    assert.equal(res.status, 404);
    assert.equal(data.success, false);
  });

  // Application submission: POST /api/applications with valid salesTrackingToken
  test('POST /api/applications attributes submission to officer when valid token provided', async () => {
    const payload = {
      phone: '0719998888',
      serviceType: 'new-connection',
      salesTrackingToken: trackingToken,
      formData: {
        fullName: 'Attributed Web Customer',
        nic: '199512345678',
        phone: '0719998888',
        selectedProduct: '300 Mbps Fibre Broadband',
      },
    };

    const res = await fetch(`${BASE_URL}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.status !== 201) {
      console.error('DEBUG APPLICATION SUBMIT FAILED:', data);
    }

    assert.equal(res.status, 201);
    assert.equal(data.success, true);

    const ref = data.application?.referenceNumber;
    assert.ok(ref);

    const savedApp = await Application.findOne({ referenceNumber: ref });
    assert.ok(savedApp);
    createdAppIds.push(savedApp._id);

    assert.equal(String(savedApp.salesOfficer), String(officerUser._id));
    assert.equal(savedApp.salesOfficerEmployeeNumber, '095756');
    assert.equal(savedApp.salesTrackingToken, trackingToken);
    assert.equal(savedApp.salesAttribution.employeeNumber, '095756');
  });

  // Application submission: POST /api/applications with invalid token rejected
  test('POST /api/applications rejects submission if invalid tracking token provided', async () => {
    const payload = {
      phone: '0719998889',
      serviceType: 'new-connection',
      salesTrackingToken: 'COMPLETELY_INVALID_TOKEN',
      formData: {
        fullName: 'Malicious Customer',
        nic: '199512345679',
        phone: '0719998889',
      },
    };

    const res = await fetch(`${BASE_URL}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    assert.equal(res.status, 400);
    assert.equal(data.success, false);
    assert.match(data.message, /invalid.*tracking.*token/i);
  });

  // Sales Officer self-service endpoint: GET /api/v1/sales-officer/me/statistics
  test('GET /api/v1/sales-officer/me/statistics returns authenticated officer statistics', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/sales-officer/me/statistics`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.officer.employeeNumber, '095756');
    assert.ok(typeof data.statistics.totalApplications === 'number');
    assert.ok(typeof data.statistics.totalCompletedSales === 'number');
    assert.ok(typeof data.statistics.completionRate === 'number');
  });

  // Sales Officer self-service endpoint: GET /api/v1/sales-officer/me/applications
  test('GET /api/v1/sales-officer/me/applications returns attributed applications only', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/sales-officer/me/applications`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.applications));

    // Every returned application must belong to officer 095756
    data.applications.forEach((app) => {
      assert.equal(app.salesOfficerEmployeeNumber, '095756');
    });
  });

  // Sales Officer self-service endpoint: GET /api/v1/sales-officer/me/qr
  test('GET /api/v1/sales-officer/me/qr retrieves authenticated officer own QR code', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/sales-officer/me/qr`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.qr.employeeNumber, '095756');
    assert.equal(data.qr.trackingToken, trackingToken);
  });
});
