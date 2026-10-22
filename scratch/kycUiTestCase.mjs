// Creates (or removes) ONE clearly-labelled synthetic KYC case for checking the
// admin KYC page: a test registered customer (registered 30 days ago) sending a
// live selfie and a signature (blank test images — no real person).
//   node scratch/kycUiTestCase.mjs create
//   node scratch/kycUiTestCase.mjs remove
import 'dotenv/config';
import mongoose from 'mongoose';
import sharp from 'sharp';
import Customer from '../models/Customer.js';
import Application from '../models/Application.js';
import KycReview from '../models/admin/kycReviewModel.js';
import AuditLog from '../models/AuditLog.js';
import { reviewApplicationAuto } from '../services/kycAutoReviewService.js';

const TEST_NIC = '199015009999';
const TEST_PHONE = '0700000999';
const TEST_NAME = 'KYC Selftest Person';
const TAG = 'kyc-selftest';
const DAY = 24 * 3600 * 1000;

const blank = (mean) => sharp({ create: { width: 600, height: 400, channels: 3, noise: { type: 'gaussian', mean, sigma: 40 } } }).png().toBuffer();
async function store(buffer, uploadedAt) {
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  return new Promise((resolve, reject) => {
    const s = bucket.openUploadStream(`${TAG}-${Date.now()}`, { metadata: { kind: TAG, uploadedAt } });
    s.on('error', reject);
    s.on('finish', () => resolve(s.id));
    s.end(buffer);
  });
}

async function remove() {
  const apps = await Application.find({ nic: TEST_NIC, 'formData.nameFull': TEST_NAME }).select('_id referenceNumber').lean();
  const customers = await Customer.find({ NIC: TEST_NIC, name: TEST_NAME }).select('_id').lean();
  const subjectIds = [...apps.map((a) => a._id), ...customers.map((c) => c._id)];
  const refs = apps.map((a) => a.referenceNumber);
  const r1 = await KycReview.deleteMany({ subjectId: { $in: subjectIds } });
  const r2 = await AuditLog.deleteMany({ targetId: { $in: [...refs, ...subjectIds.map(String)] } });
  const r3 = await Application.deleteMany({ _id: { $in: apps.map((a) => a._id) } });
  const r4 = await Customer.deleteMany({ _id: { $in: customers.map((c) => c._id) } });
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  const files = await mongoose.connection.db.collection('uploads.files').find({ 'metadata.kind': TAG }).project({ _id: 1 }).toArray();
  for (const f of files) await bucket.delete(f._id);
  console.log(`removed: ${r3.deletedCount} test request(s), ${r4.deletedCount} test customer(s), ${r1.deletedCount} review(s), ${r2.deletedCount} audit entr(ies), ${files.length} test image(s)`);
}

await mongoose.connect(process.env.MONGO_URI);
try {
  if (process.argv[2] === 'remove') await remove();
  else {
    if (await Customer.exists({ $or: [{ NIC: TEST_NIC }, { phone: TEST_PHONE }] })) throw new Error('test NIC/phone already in use — run "remove" first');
    const old = new Date(Date.now() - 30 * DAY);
    const nicFront = await store(await blank(190), old);
    const nicBack = await store(await blank(110), old);
    const oldSelfie = await store(await blank(150), old);
    const newSelfie = await store(await blank(130), new Date());

    const customer = await Customer.create({
      name: TEST_NAME, phone: TEST_PHONE, NIC: TEST_NIC, role: 'Customer', dob: '1990-05-29', gender: 'Male',
      identityDocuments: { nicFront, nicBack, facePhoto: newSelfie, capturedAt: new Date() },
    });
    await Customer.collection.updateOne({ _id: customer._id }, { $set: { createdAt: old } });

    const signature = await store(await blank(240), new Date());
    // A registered customer's request: live selfie + signature only.
    const docs = { facePhoto: `gridfs://${newSelfie}`, signature: `gridfs://${signature}` };
    const app = await Application.create({
      phone: TEST_PHONE, serviceType: 'reconnection', nic: TEST_NIC, status: 'pending',
      formData: { nameFull: TEST_NAME, documents: docs }, documents: docs,
    });
    const result = await reviewApplicationAuto(app);
    console.log(`created ${app.referenceNumber} (unused old selfie ${oldSelfie}) → ${result.decision}`);
  }
} finally {
  await mongoose.disconnect();
}
