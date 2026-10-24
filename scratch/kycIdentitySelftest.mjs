// KYC identity-check self-test — synthetic data only.
// Creates a clearly-labelled test customer + blank test images, evaluates
// unsaved test requests against them, prints the results, then deletes it all.
// Run:  node scratch/kycIdentitySelftest.mjs
import 'dotenv/config';
import mongoose from 'mongoose';
import sharp from 'sharp';
import Customer from '../models/Customer.js';
import { evaluateApplication, evaluateAccount } from '../services/kycAutoReviewService.js';

const TEST_NIC = '199015009999';
const TEST_PHONE = '0700000999';
const TAG = 'kyc-selftest';
const DAY = 24 * 3600 * 1000;

const blank = (r, g, b) => sharp({
  create: { width: 600, height: 400, channels: 3, noise: { type: 'gaussian', mean: (r + g + b) / 3, sigma: 40 } },
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
  console.log(`\n■ ${title} → ${ev.decision.toUpperCase()}  (customer type: ${ev.caseInfo?.customerType})`);
  ev.checks.forEach((c) => console.log(`   ${c.result.padEnd(6)} ${c.label}: ${c.detail}`));
};

const fakeApp = (docs, extra = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  nic: TEST_NIC,
  phone: TEST_PHONE,
  status: 'pending',
  createdAt: new Date(),
  formData: { nameFull: 'KYC Selftest Person', documents: docs },
  documents: docs,
  ...extra,
});

await mongoose.connect(process.env.MONGO_URI);
const created = { files: [], customer: null };
try {
  if (await Customer.exists({ $or: [{ NIC: TEST_NIC }, { phone: TEST_PHONE }] })) throw new Error('test NIC/phone already in use — aborting');

  const old = new Date(Date.now() - 30 * DAY);
  const now = new Date();
  const [nicF, nicB, oldSelfie, newSelfie] = await Promise.all([blank(200, 180, 160), blank(90, 120, 160), blank(150, 150, 150), blank(170, 140, 120)]);
  const ids = {
    nicFrontOld: await storeTest(nicF, old),
    nicBackOld: await storeTest(nicB, old),
    selfieOld: await storeTest(oldSelfie, old),
    selfieNew: await storeTest(newSelfie, now),
    nicFrontNew: await storeTest(nicF, now),
    nicBackNew: await storeTest(nicB, now),
  };
  created.files = Object.values(ids);

  // A — new customer: everything uploaded with the request (inline images), no account yet
  const inline = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
  show('A  New customer, NIC + selfie in the request, no account', await evaluateApplication(
    fakeApp({ nicFront: inline(nicF), nicBack: inline(nicB), facePhoto: inline(newSelfie) })));

  // Test customer registered 30 days ago, NIC photos + selfie on file
  created.customer = await Customer.create({
    name: 'KYC Selftest Person', phone: TEST_PHONE, NIC: TEST_NIC, role: 'Customer', dob: '1990-05-29', gender: 'Male',
    identityDocuments: { nicFront: ids.nicFrontOld, nicBack: ids.nicBackOld, facePhoto: ids.selfieOld, capturedAt: old },
  });
  // createdAt is immutable through Mongoose, so back-date the test record directly.
  await Customer.collection.updateOne({ _id: created.customer._id }, { $set: { createdAt: old } });

  show('B  Returning customer, NIC on file + NEW selfie', await evaluateApplication(
    fakeApp({ nicFront: `gridfs://${ids.nicFrontOld}`, nicBack: `gridfs://${ids.nicBackOld}`, facePhoto: `gridfs://${ids.selfieNew}` })));

  show('C  Returning customer, NO new selfie (old one reused)', await evaluateApplication(
    fakeApp({ nicFront: `gridfs://${ids.nicFrontOld}`, nicBack: `gridfs://${ids.nicBackOld}`, facePhoto: `gridfs://${ids.selfieOld}` })));

  show('D  "Selfie" is the NIC image file', await evaluateApplication(
    fakeApp({ nicFront: `gridfs://${ids.nicFrontOld}`, nicBack: `gridfs://${ids.nicBackOld}`, facePhoto: `gridfs://${ids.nicFrontOld}` })));

  show('E  Existing customer adding NIC photos now', await evaluateApplication(
    fakeApp({ nicFront: `gridfs://${ids.nicFrontNew}`, nicBack: `gridfs://${ids.nicBackNew}`, facePhoto: `gridfs://${ids.selfieNew}` })));

  await Customer.updateOne({ _id: created.customer._id }, { $set: { identityDocuments: { facePhoto: ids.selfieOld, capturedAt: old } } });
  show('F  Returning customer with NO NIC photos on file, selfie only', await evaluateApplication(
    fakeApp({ facePhoto: `gridfs://${ids.selfieNew}` })));

  await Customer.updateOne({ _id: created.customer._id }, { $set: { identityDocuments: { nicFront: ids.nicFrontNew, nicBack: ids.nicBackNew, facePhoto: ids.selfieNew, capturedAt: now } } });
  show('G  Account registration (no request yet)', await evaluateAccount(await Customer.findById(created.customer._id).lean()));
} finally {
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  for (const id of created.files) await bucket.delete(id).catch(() => {});
  if (created.customer) await Customer.deleteOne({ _id: created.customer._id });
  const leftovers = await mongoose.connection.db.collection('uploads.files').countDocuments({ 'metadata.kind': TAG })
    + await Customer.countDocuments({ NIC: TEST_NIC });
  console.log(`\ncleanup done — leftover test records: ${leftovers}`);
  await mongoose.disconnect();
}
