// KYC identity-check self-test — synthetic data only.
// Creates clearly-labelled test customers + blank test images, evaluates
// unsaved test requests against them, prints the results, then deletes it all.
// Run:  node scratch/kycIdentitySelftest.mjs
import 'dotenv/config';
import mongoose from 'mongoose';
import sharp from 'sharp';
import Customer from '../models/Customer.js';
import { evaluateApplication, evaluateAccount } from '../services/kycAutoReviewService.js';

const TEST_NIC = '199015009999';     // same person as 901509999V (old format)
const TEST_NIC_OLD = '901509999V';
const TEST_PHONE = '0700000999';
const OTHER_PHONE = '0700000998';
const TAG = 'kyc-selftest';
const DAY = 24 * 3600 * 1000;

const blank = (mean) => sharp({
  create: { width: 600, height: 400, channels: 3, noise: { type: 'gaussian', mean, sigma: 40 } },
}).png().toBuffer();

async function storeTest(buffer, uploadedAt) {
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  return new Promise((resolve, reject) => {
    // No contentType — like most real uploads since the MongoDB driver upgrade.
    const s = bucket.openUploadStream(`${TAG}-${Date.now()}`, { metadata: { kind: TAG, uploadedAt } });
    s.on('error', reject);
    s.on('finish', () => resolve(s.id));
    s.end(buffer);
  });
}

const show = (title, ev) => {
  console.log(`\n■ ${title} → ${ev.decision.toUpperCase()}  (customer: ${ev.caseInfo?.customerType})`);
  ev.checks.forEach((c) => console.log(`   ${c.result.padEnd(6)} ${c.label}: ${c.detail}`));
};

const fakeApp = (docs, extra = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  nic: TEST_NIC,
  phone: TEST_PHONE,
  status: 'pending',
  createdAt: new Date(),
  formData: { nameFull: 'KYC Selftest Person', documents: docs, ...(extra.formData || {}) },
  documents: docs,
});

await mongoose.connect(process.env.MONGO_URI);
const created = { files: [], customers: [] };
try {
  if (await Customer.exists({ $or: [{ NIC: { $in: [TEST_NIC, TEST_NIC_OLD] } }, { phone: { $in: [TEST_PHONE, OTHER_PHONE] } }] })) {
    throw new Error('test NIC/phone already in use — aborting');
  }

  const old = new Date(Date.now() - 30 * DAY);
  const now = new Date();
  const ids = {
    nicFrontNew: await storeTest(await blank(190), now),
    nicBackNew: await storeTest(await blank(110), now),
    selfieOld: await storeTest(await blank(150), old),
    selfieNew: await storeTest(await blank(130), now),
    signature: await storeTest(await blank(240), now),
  };
  created.files = Object.values(ids);
  const g = (id) => `gridfs://${id}`;

  // ── New customer: account created with this request ──
  const fresh = await Customer.create({
    name: 'KYC Selftest Person', phone: TEST_PHONE, NIC: TEST_NIC, role: 'Customer', dob: '1990-05-29', gender: 'Male',
    identityDocuments: { nicFront: ids.nicFrontNew, nicBack: ids.nicBackNew, facePhoto: ids.selfieNew, capturedAt: now },
  });
  created.customers.push(fresh._id);

  show('1  New customer: NIC front + back, selfie, signature', await evaluateApplication(
    fakeApp({ nicFront: g(ids.nicFrontNew), nicBack: g(ids.nicBackNew), facePhoto: g(ids.selfieNew), signature: g(ids.signature) })));

  show('2  New customer, no signature drawn (OTP only)', await evaluateApplication(
    fakeApp({ nicFront: g(ids.nicFrontNew), nicBack: g(ids.nicBackNew), facePhoto: g(ids.selfieNew), signature: 'DIGITALLY_VERIFIED_OTP' })));

  await Customer.updateOne({ _id: fresh._id }, { $unset: { 'identityDocuments.nicBack': 1 } });
  show('3  New customer missing NIC back', await evaluateApplication(
    fakeApp({ nicFront: g(ids.nicFrontNew), facePhoto: g(ids.selfieNew), signature: g(ids.signature) })));
  await Customer.updateOne({ _id: fresh._id }, { $set: { 'identityDocuments.nicBack': ids.nicBackNew } });

  // ── Same customer, registered 30 days ago ──
  await Customer.collection.updateOne({ _id: fresh._id }, { $set: { createdAt: old } });

  show('4  Registered customer: selfie + signature only', await evaluateApplication(
    fakeApp({ facePhoto: g(ids.selfieNew), signature: g(ids.signature) })));

  show('5  Registered customer, no signature', await evaluateApplication(
    fakeApp({ facePhoto: g(ids.selfieNew) })));

  show('6  Registered customer, old selfie reused', await evaluateApplication(
    fakeApp({ facePhoto: g(ids.selfieOld), signature: g(ids.signature) })));

  // ── Someone registers as "new" with an NIC already registered (written in old format) ──
  const dup = await Customer.create({
    name: 'KYC Selftest Duplicate', phone: OTHER_PHONE, NIC: TEST_NIC_OLD, role: 'Customer', dob: '1990-05-29', gender: 'Male',
    identityDocuments: { nicFront: ids.nicFrontNew, nicBack: ids.nicBackNew, facePhoto: ids.selfieNew, capturedAt: now },
  });
  created.customers.push(dup._id);
  show('7  New registration reusing a registered NIC (old format)', await evaluateAccount(await Customer.findById(dup._id).lean()));

  await Customer.deleteOne({ _id: dup._id });
  show('8  Account registration only (no request yet)', await evaluateAccount(
    { ...(await Customer.findById(fresh._id).lean()), createdAt: now }));
} finally {
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  for (const id of created.files) await bucket.delete(id).catch(() => {});
  await Customer.deleteMany({ _id: { $in: created.customers } });
  const leftovers = await mongoose.connection.db.collection('uploads.files').countDocuments({ 'metadata.kind': TAG })
    + await Customer.countDocuments({ NIC: { $in: [TEST_NIC, TEST_NIC_OLD] } });
  console.log(`\ncleanup done — leftover test records: ${leftovers}`);
  await mongoose.disconnect();
}
