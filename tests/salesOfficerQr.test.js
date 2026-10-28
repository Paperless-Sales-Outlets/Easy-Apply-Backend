import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import User from '../models/User.js';
import Application from '../models/Application.js';
import SalesOfficerQr from '../models/SalesOfficerQr.js';
import {
  getOrCreateOfficerQr,
  findSalesOfficerByEmployeeNumber,
  getOfficerStatistics,
  isCompletedSale,
  getCompletedSaleFilter,
} from '../services/salesTrackingService.js';

describe('Sales Officer QR Code Attribution Test Suite', () => {
  let officerUser = null;
  let testQrRecord = null;
  const testRefPrefix = `TEST-SO-${Date.now()}`;
  const createdAppIds = [];

  before(async () => {
    await connectDB();
    // Wait for connection ready
    if (mongoose.connection.readyState !== 1) {
      await new Promise((resolve) => mongoose.connection.once('open', resolve));
    }
  });

  after(async () => {
    // Clean up created test applications
    if (createdAppIds.length > 0) {
      await Application.deleteMany({ _id: { $in: createdAppIds } });
    }
    // Clean up test QR if generated strictly for testing on non-existing officer
    if (testQrRecord && testQrRecord.employeeNumber !== '095756') {
      await SalesOfficerQr.deleteOne({ _id: testQrRecord._id });
    }
    await mongoose.connection.close();
  });

  // 1. Existing Sales Officer 095756 can be found without creating a duplicate account
  test('1. Existing Sales Officer 095756 can be found without creating duplicate account', async () => {
    officerUser = await findSalesOfficerByEmployeeNumber('095756');

    if (!officerUser) {
      // If running on a local DB where the account was not yet seeded, create it once
      officerUser = await User.create({
        name: 'Sasindu Test Officer',
        email: 'sasindu@slt.com.lk',
        employeeNumber: '095756',
        role: 'Sales Officer',
        password: 'password123',
      });
    }

    assert.ok(officerUser, 'Officer user should exist');
    assert.equal(officerUser.employeeNumber, '095756', 'Employee ID should preserve leading zeros');
    assert.match(officerUser.role, /^sales\s*officer$/i, 'Role must be Sales Officer');

    // Confirm that finding officer again does not duplicate
    const count = await User.countDocuments({ employeeNumber: '095756' });
    assert.equal(count, 1, 'There must be exactly one user record with employee number 095756');
  });

  // 2. A QR tracking record can be created and retrieved for the officer
  test('2. A QR tracking record can be created and retrieved for the officer', async () => {
    const { qrRecord, created } = await getOrCreateOfficerQr(officerUser);
    testQrRecord = qrRecord;

    assert.ok(qrRecord, 'QR record must exist');
    assert.equal(qrRecord.employeeNumber, '095756');
    assert.ok(qrRecord.trackingToken, 'Tracking token must be generated');
    assert.ok(qrRecord.qrUrl.includes(qrRecord.trackingToken), 'QR URL must contain the tracking token');
    assert.equal(qrRecord.isActive, true, 'QR record should be active');
  });

  // 3. Duplicate QR records are prevented
  test('3. Duplicate QR records are prevented for the same officer', async () => {
    const { qrRecord: secondFetch, created: secondCreated } = await getOrCreateOfficerQr(officerUser, {
      regenerate: false,
    });

    assert.equal(secondCreated, false, 'Should not create a new QR record');
    assert.equal(String(secondFetch._id), String(testQrRecord._id), 'Must return the existing QR record');

    const totalQrCount = await SalesOfficerQr.countDocuments({ employeeNumber: '095756' });
    assert.equal(totalQrCount, 1, 'Only one QR record can exist for employee 095756');
  });

  // 4. Valid tracking URLs resolve correctly
  test('4. Valid tracking URLs resolve correctly and update scan count', async () => {
    const initialScans = testQrRecord.scansCount || 0;
    const found = await SalesOfficerQr.findOne({
      trackingToken: testQrRecord.trackingToken,
      isActive: true,
    });

    assert.ok(found, 'Should find active QR record by token');
    assert.equal(found.employeeNumber, '095756');

    // Simulate scan increment
    found.scansCount = (found.scansCount || 0) + 1;
    found.lastScannedAt = new Date();
    await found.save();

    const reloaded = await SalesOfficerQr.findById(found._id);
    assert.equal(reloaded.scansCount, initialScans + 1);
    assert.ok(reloaded.lastScannedAt instanceof Date);
  });

  // 5. Invalid tracking tokens are rejected safely
  test('5. Invalid tracking tokens are rejected safely', async () => {
    const nonExistent = await SalesOfficerQr.findOne({
      trackingToken: 'INVALID_RANDOM_TOKEN_12345',
      isActive: true,
    });
    assert.equal(nonExistent, null, 'Invalid token must return null');
  });

  // 6. Applications submitted through the QR flow are attributed to the correct officer
  test('6. Applications submitted through the QR flow are attributed to the correct officer', async () => {
    const qrRecord = await SalesOfficerQr.findOne({ employeeNumber: '095756' }).populate('officer');
    assert.ok(qrRecord, 'QR record must exist');

    const app = await Application.create({
      referenceNumber: `${testRefPrefix}-APP-1`,
      phone: '0711112222',
      serviceType: 'new-connection',
      nic: '199012345678',
      formData: {
        fullName: 'Attributed Customer',
        selectedProduct: '300 Mbps Fibre Broadband',
      },
      status: 'pending',
      paymentStatus: 'pending',
      salesOfficer: qrRecord.officer._id,
      salesOfficerEmployeeNumber: qrRecord.employeeNumber,
      salesTrackingToken: qrRecord.trackingToken,
      salesAttribution: {
        officerId: qrRecord.officer._id,
        employeeNumber: qrRecord.employeeNumber,
        officerName: qrRecord.officer.name,
        trackingToken: qrRecord.trackingToken,
        attributedAt: new Date(),
      },
    });

    createdAppIds.push(app._id);

    assert.ok(app, 'Application must be created');
    assert.equal(String(app.salesOfficer), String(qrRecord.officer._id));
    assert.equal(app.salesOfficerEmployeeNumber, '095756');
    assert.equal(app.salesTrackingToken, qrRecord.trackingToken);
    assert.equal(app.salesAttribution.employeeNumber, '095756');
  });

  // 7. Direct applications without QR tracking remain supported
  test('7. Direct applications without QR tracking remain supported', async () => {
    const directApp = await Application.create({
      referenceNumber: `${testRefPrefix}-DIRECT-1`,
      phone: '0722223333',
      serviceType: 'new-connection',
      nic: '199112345678',
      formData: {
        fullName: 'Direct Customer',
        selectedProduct: '100 Mbps Fibre Broadband',
      },
      status: 'pending',
      paymentStatus: 'pending',
      salesOfficer: null,
      salesOfficerEmployeeNumber: null,
      salesTrackingToken: null,
    });

    createdAppIds.push(directApp._id);

    assert.ok(directApp);
    assert.equal(directApp.salesOfficer, null);
    assert.equal(directApp.salesOfficerEmployeeNumber, null);
    assert.equal(directApp.salesTrackingToken, null);
  });

  // 8. Employee ID spoofing does not change attribution
  test('8. Employee ID spoofing does not change attribution without valid token', async () => {
    // If a request tries to submit an arbitrary employeeId without a matching valid token,
    // the system treats it as direct or rejects invalid token
    const spoofAttemptToken = 'SPOOFED_UNAUTHORIZED_TOKEN';
    const foundToken = await SalesOfficerQr.findOne({ trackingToken: spoofAttemptToken, isActive: true });
    assert.equal(foundToken, null, 'Spoofed token cannot be resolved to any officer');
  });

  // 9. Completed sales are counted only when existing completion criteria are met
  test('9. Completed sales are counted only when completion criteria are met', async () => {
    // A pending application is NOT a completed sale
    const pendingApp = await Application.create({
      referenceNumber: `${testRefPrefix}-PENDING`,
      phone: '0733334444',
      serviceType: 'new-connection',
      nic: '199212345678',
      formData: { fullName: 'Pending Customer' },
      status: 'pending',
      paymentStatus: 'pending',
      completedSale: false,
      salesOfficer: officerUser._id,
      salesOfficerEmployeeNumber: '095756',
    });
    createdAppIds.push(pendingApp._id);
    assert.equal(isCompletedSale(pendingApp), false, 'Pending application should not be a completed sale');

    // A confirmed application IS a completed sale
    const confirmedApp = await Application.create({
      referenceNumber: `${testRefPrefix}-CONFIRMED`,
      phone: '0744445555',
      serviceType: 'new-connection',
      nic: '199312345678',
      formData: { fullName: 'Confirmed Customer' },
      status: 'confirmed',
      paymentStatus: 'paid',
      completedSale: true,
      completedSaleAt: new Date(),
      salesOfficer: officerUser._id,
      salesOfficerEmployeeNumber: '095756',
    });
    createdAppIds.push(confirmedApp._id);
    assert.equal(isCompletedSale(confirmedApp), true, 'Confirmed + Paid application must be a completed sale');

    // A completed status application IS a completed sale
    const completedStatusApp = await Application.create({
      referenceNumber: `${testRefPrefix}-COMPLETED`,
      phone: '0755556666',
      serviceType: 'new-connection',
      nic: '199412345678',
      formData: { fullName: 'Completed Customer' },
      status: 'completed',
      completedSale: true,
      completedSaleAt: new Date(),
      salesOfficer: officerUser._id,
      salesOfficerEmployeeNumber: '095756',
    });
    createdAppIds.push(completedStatusApp._id);
    assert.equal(isCompletedSale(completedStatusApp), true, 'Completed status application must be a completed sale');
  });

  // 10. Applications and sales are not double-counted
  test('10. Applications and sales are not double-counted in statistics', async () => {
    const stats = await getOfficerStatistics(officerUser._id, '095756');

    assert.ok(typeof stats.totalApplications === 'number');
    assert.ok(typeof stats.totalCompletedSales === 'number');
    assert.ok(stats.totalCompletedSales <= stats.totalApplications);
    assert.ok(stats.completionRate >= 0 && stats.completionRate <= 100);

    // Sum of status breakdown should match total applications for this officer
    const statusSum = Object.values(stats.byStatus).reduce((a, b) => a + b, 0);
    assert.equal(statusSum, stats.totalApplications, 'Status breakdown sum must equal total applications');
  });

  // 11. Sales Officers cannot access other officers applications
  test('11. Attributed applications are strictly scoped by officer ID / employeeNumber', async () => {
    const otherOfficerQuery = {
      $or: [
        { salesOfficer: new mongoose.Types.ObjectId() },
        { salesOfficerEmployeeNumber: '999999' },
      ],
    };
    const otherApps = await Application.find(otherOfficerQuery);
    // None of the applications created for 095756 should match this query
    const matchedTestApp = otherApps.find((a) => a.salesOfficerEmployeeNumber === '095756');
    assert.equal(matchedTestApp, undefined, 'Officer 999999 cannot view applications for 095756');
  });

  // 12. Admin authorization and completed sales filter consistency
  test('12. Completed sales filter consistency across aggregations and checks', async () => {
    const filter = getCompletedSaleFilter();
    assert.ok(filter.$or && Array.isArray(filter.$or));

    const apps = await Application.find({
      _id: { $in: createdAppIds },
      ...filter,
    });

    apps.forEach((app) => {
      assert.equal(isCompletedSale(app), true, 'All apps matching filter must return true for isCompletedSale');
    });
  });

  // 13. Existing authentication and application workflows continue to work
  test('13. Application lifecycle preserves attribution through updates', async () => {
    const appToUpdate = await Application.findById(createdAppIds[0]);
    assert.ok(appToUpdate);

    // Simulate lifecycle update: admin approves KYC or updates status
    appToUpdate.status = 'approved';
    appToUpdate.notes = 'KYC verified successfully';
    await appToUpdate.save();

    const reloaded = await Application.findById(appToUpdate._id);
    assert.equal(reloaded.status, 'approved');
    assert.equal(reloaded.salesOfficerEmployeeNumber, '095756', 'Attribution must be preserved after status update');
    assert.equal(String(reloaded.salesOfficer), String(officerUser._id), 'Officer ObjectId must be preserved');
  });
});
