import { pool } from '../config/db.js';
import { isStorageConfigured, getStorageClient } from '../services/storageService.js';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import 'dotenv/config';

async function checkSetup() {
  console.log('==============================================');
  console.log('   SLT EasyApply - Supabase Setup Checker     ');
  console.log('==============================================\n');

  // 1. Check PostgreSQL Connection
  console.log('1. Checking PostgreSQL / Supabase Connection...');
  try {
    const res = await pool.query('SELECT NOW() as now, current_database() as db, version() as ver;');
    console.log(`   Connected to Database: "${res.rows[0].db}"`);
    console.log(`   Server Timestamp:     ${res.rows[0].now}`);
    console.log(`   PostgreSQL Version:   ${res.rows[0].ver.split(' ')[0]} ${res.rows[0].ver.split(' ')[1]}`);
  } catch (err) {
    console.error('   ❌ Database connection failed:', err.message);
    process.exit(1);
  }

  // 2. Check Tables Created
  console.log('\n2. Checking Tables in "public" schema...');
  try {
    const tableRes = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);

    const expectedTables = [
      'applications',
      'audit_logs',
      'cart_items',
      'carts',
      'connections',
      'customers',
      'kyc_reviews',
      'leads',
      'new_connection_drafts',
      'otp_lockouts',
      'otps',
      'privileges',
      'products',
      'refresh_tokens',
      'sales_officer_qrs',
      'staff_roles',
      'users',
    ];

    const foundTables = tableRes.rows.map((r) => r.table_name);
    console.log(`   Found ${foundTables.length} tables in Supabase:`);
    foundTables.forEach((t) => console.log(`     ✔ ${t}`));

    const missingTables = expectedTables.filter((t) => !foundTables.includes(t));
    if (missingTables.length > 0) {
      console.warn(`\n   ⚠️ Missing expected tables: ${missingTables.join(', ')}`);
    } else {
      console.log('\n   All 17 expected tables exist with correct schema!');
    }
  } catch (err) {
    console.error('   ❌ Error querying tables:', err.message);
  }

  // 3. Check Storage Configuration
  console.log('\n3. Checking Centralized Object Storage (S3 / Supabase)...');
  if (isStorageConfigured()) {
    try {
      const client = getStorageClient();
      const bucket = process.env.STORAGE_BUCKET || 'kyc-documents';
      console.log(`   Connecting to bucket "${bucket}"...`);
      const command = new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 5 });
      const storageRes = await client.send(command);
      console.log(`    Storage connected successfully! (HTTP ${storageRes.$metadata.httpStatusCode})`);
    } catch (err) {
      console.warn(`   ⚠️ Storage access test failed: ${err.message}`);
    }
  } else {
    console.log('   ℹ Storage keys not yet configured or left placeholder in .env.');
  }

  console.log('\n==============================================');
  console.log('   Verification Complete!                     ');
  console.log('==============================================');
  await pool.end();
}

checkSetup().catch((err) => {
  console.error('Fatal error during setup check:', err);
  process.exit(1);
});

