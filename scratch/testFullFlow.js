import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const dummyImg = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const phone = '778899112';
  const nic = '200388991122';

  console.log('=== STEP 1: Customer Registration with NIC Front/Back ===');
  const regRes = await fetch('http://localhost:5050/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Mr. EndToEnd Customer',
      phone: phone,
      NIC: nic,
      title: 'Mr.',
      dob: '2003-05-15',
      gender: 'Male',
      addressLine1: '100 Galle Road',
      city: 'Colombo 03',
      district: 'Colombo',
      postalCode: '00300',
      preferredContact: 'SMS',
      nicFront: dummyImg,
      nicBack: dummyImg,
    }),
  });
  const regData = await regRes.json();
  console.log('Register Status:', regRes.status, 'User ID:', regData.user?.id, 'Docs Attached:', regData.user?.identityDocuments);

  console.log('\n=== STEP 2: Submit New Connection Wizard with Digital Signature ===');
  const appRes = await fetch('http://localhost:5050/api/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serviceType: 'new-connection',
      phone: phone,
      formData: {
        customerType: 'home',
        title: 'Mr.',
        nameFull: 'Mr. EndToEnd Customer',
        nic: nic,
        mobileNumber: phone,
        installAddress: '100 Galle Road, Colombo 03',
        city: 'Colombo 03',
        district: 'Colombo',
        postalCode: '00300',
        declarationAccepted: true,
        signature: dummyImg,
        paymentReference: 'PAY-DEMO-123456',
        product: { productName: 'Fibre Ultra 200Mbps', monthlyPrice: 4500, installationFee: 2500 },
      },
    }),
  });
  const appData = await appRes.json();
  const ref = appData.application?.referenceNumber;
  console.log('Application Status:', appRes.status, 'Reference Number:', ref);

  console.log('\n=== STEP 3: Customer Check Status with Ref Number ===');
  const statusRes = await fetch('http://localhost:5050/api/applications/check-status?referenceNumber=' + ref);
  const statusData = await statusRes.json();
  console.log('Check Status Status:', statusRes.status, 'Found App:', statusData.application ? { ref: statusData.application.referenceNumber, status: statusData.application.status, service: statusData.application.serviceType } : 'Not Found');

  console.log('\n=== STEP 4: Admin KYC Review Queue ===');
  const adminLogin = await fetch('http://localhost:5050/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@slt.lk', password: 'admin123' }),
  });
  const adminToken = (await adminLogin.json()).accessToken;
  const kycRes = await fetch('http://localhost:5050/api/admin/kyc', {
    headers: { Authorization: 'Bearer ' + adminToken },
  });
  const kycData = await kycRes.json();
  const kycItem = kycData.queue?.find(q => q.nic === nic);
  console.log('Admin KYC Queue Item Found:', kycItem ? {
    id: kycItem.id,
    name: kycItem.name,
    nic: kycItem.nic,
    status: kycItem.status,
    documentsCount: kycItem.documents?.length,
    documents: kycItem.documents,
  } : 'NOT FOUND IN KYC');

  if (kycItem) {
    console.log('\n=== STEP 5: Admin Approves KYC ===');
    const reviewRes = await fetch('http://localhost:5050/api/admin/kyc/' + kycItem.id + '/review', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + adminToken,
      },
      body: JSON.stringify({ status: 'approved', notes: 'Verified and approved for demo' }),
    });
    const reviewData = await reviewRes.json();
    console.log('Review Action Status:', reviewRes.status, 'Result Status:', reviewData.application?.status);
  }

  console.log('\n=== STEP 6: Check MongoDB GridFS Chunks & Collections ===');
  await mongoose.connect(process.env.MONGO_URI);
  const filesCount = await mongoose.connection.db.collection('uploads.files').countDocuments();
  const chunksCount = await mongoose.connection.db.collection('uploads.chunks').countDocuments();
  console.log('GridFS files count in DB:', filesCount);
  console.log('GridFS chunks count in DB:', chunksCount);

  process.exit(0);
}

run();
