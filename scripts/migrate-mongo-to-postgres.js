/**
 * SLT EasyApply - MongoDB Atlas to PostgreSQL (Supabase / Company DB) ETL Migration Script
 *
 * Usage:
 *   node scripts/migrate-mongo-to-postgres.js [--dry-run]
 *
 * Environment variables needed:
 *   MONGO_URI    - Source MongoDB connection string
 *   DATABASE_URL - Target PostgreSQL connection string
 */

import { MongoClient } from 'mongodb';
import pg from 'pg';
import crypto from 'node:crypto';
import dns from 'node:dns';
import 'dotenv/config';

// Configure DNS to use reliable public resolvers for MongoDB Atlas shard lookups
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch (err) {
  console.warn('⚠️ Could not set custom DNS servers:', err.message);
}

const { Pool } = pg;
const isDryRun = process.argv.includes('--dry-run');

// Generate deterministic UUID from MongoDB ObjectId string
function mongoIdToUuid(mongoId) {
  if (!mongoId) return null;
  const hex = String(mongoId).toLowerCase().padStart(32, '0');
  // Format as 8-4-4-4-12 UUID
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function runEtl() {
  console.log('====================================================');
  console.log('SLT EasyApply: MongoDB Atlas -> PostgreSQL ETL Tool');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no database writes)' : 'LIVE EXECUTION'}`);
  console.log('====================================================\n');

  const mongoUri = process.env.MONGO_URI;
  const pgUri = process.env.DATABASE_URL;

  if (!mongoUri) {
    console.error('❌ MONGO_URI is not set in environment.');
    process.exit(1);
  }
  if (!pgUri && !isDryRun) {
    console.error('❌ DATABASE_URL is not set in environment.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB Atlas...');
  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  const mongoDb = mongoClient.db();
  console.log(' Connected to MongoDB:', mongoDb.databaseName);

  let pgPool = null;
  if (!isDryRun) {
    console.log('Connecting to PostgreSQL...');
    pgPool = new Pool({
      connectionString: pgUri,
      ssl: pgUri.includes('sslmode=require') || pgUri.includes('.supabase.co') ? { rejectUnauthorized: false } : false,
    });
    const testRes = await pgPool.query('SELECT NOW() as now, current_database() as db');
    console.log(` Connected to PostgreSQL: database "${testRes.rows[0].db}"\n`);
  }

  const userIdMap = new Map(); // mongoId -> postgresUuid

  try {
    // -------------------------------------------------------------------------
    // 1. MIGRATE STAFF ROLES
    // -------------------------------------------------------------------------
    console.log('--- Step 1: Migrating Staff Roles ---');
    const rolesCollection = mongoDb.collection('staffroles');
    const mongoRoles = await rolesCollection.find({}).toArray();
    console.log(`Found ${mongoRoles.length} staff roles in MongoDB.`);

    let rolesMigrated = 0;
    for (const r of mongoRoles) {
      const roleId = mongoIdToUuid(r._id);
      const name = r.name || r.roleName;
      if (!name) continue;

      if (!isDryRun) {
        await pgPool.query(
          `INSERT INTO staff_roles (id, name, description, permissions, is_system, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (name) DO UPDATE 
           SET description = EXCLUDED.description, permissions = EXCLUDED.permissions, updated_at = NOW()`,
          [
            roleId,
            name,
            r.description || '',
            Array.isArray(r.permissions) ? r.permissions : [],
            Boolean(r.isSystem),
            r.createdAt || new Date(),
            r.updatedAt || new Date(),
          ]
        );
      }
      rolesMigrated++;
    }
    console.log(` Migrated ${rolesMigrated} staff roles.\n`);

    // -------------------------------------------------------------------------
    // 2. MIGRATE USERS (Admin & Staff Accounts) - Top Priority
    // -------------------------------------------------------------------------
    console.log('--- Step 2: Migrating Users (Admin & Staff Logins) ---');
    const usersCollection = mongoDb.collection('users');
    const mongoUsers = await usersCollection.find({}).toArray();
    console.log(`Found ${mongoUsers.length} users in MongoDB.`);

    let usersMigrated = 0;
    for (const u of mongoUsers) {
      if (!u.name || (!u.email && !u.employeeNumber)) {
        console.warn(`⚠️ Skipping invalid user record: ID ${u._id}`);
        continue;
      }

      const userId = mongoIdToUuid(u._id);
      userIdMap.set(String(u._id), userId);

      const email = u.email ? u.email.toLowerCase().trim() : null;
      const phone = u.phone ? u.phone.trim() : null;
      const nic = u.NIC || u.nic ? (u.NIC || u.nic).toUpperCase().trim() : null;
      const employeeNumber = u.employeeNumber ? u.employeeNumber.trim() : null;
      const passwordHash = u.password || null;

      if (!isDryRun) {
        await pgPool.query(
          `INSERT INTO users (id, name, email, phone, nic, role, employee_number, permissions, is_active, password_hash, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (id) DO UPDATE 
           SET name = EXCLUDED.name,
               email = COALESCE(EXCLUDED.email, users.email),
               phone = COALESCE(EXCLUDED.phone, users.phone),
               role = EXCLUDED.role,
               employee_number = COALESCE(EXCLUDED.employee_number, users.employee_number),
               permissions = EXCLUDED.permissions,
               is_active = EXCLUDED.is_active,
               password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash),
               updated_at = NOW()`,
          [
            userId,
            u.name.trim(),
            email,
            phone,
            nic,
            u.role || 'Staff',
            employeeNumber,
            Array.isArray(u.permissions) ? u.permissions : [],
            u.isActive !== false,
            passwordHash,
            u.createdAt || new Date(),
            u.updatedAt || new Date(),
          ]
        );
      }
      usersMigrated++;
    }
    console.log(` Migrated ${usersMigrated} user credentials with preserved passwords.\n`);

    // -------------------------------------------------------------------------
    // 3. MIGRATE PRODUCTS CATALOG
    // -------------------------------------------------------------------------
    console.log('--- Step 3: Migrating Products Catalog ---');
    const productsCollection = mongoDb.collection('products');
    const mongoProducts = await productsCollection.find({}).toArray();
    console.log(`Found ${mongoProducts.length} products in MongoDB.`);

    let productsMigrated = 0;
    for (const p of mongoProducts) {
      const prodId = p.productId || String(p._id);
      const name = p.name || p.productName;
      const category = p.category;
      if (!name || !category) continue;

      if (!isDryRun) {
        await pgPool.query(
          `INSERT INTO products (id, product_id, product_code, name, category, service_type, speed, monthly_price, installation_fee, description, features, image, available_quantity, status, popular, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           ON CONFLICT (id) DO UPDATE 
           SET name = EXCLUDED.name,
               category = EXCLUDED.category,
               monthly_price = EXCLUDED.monthly_price,
               features = EXCLUDED.features,
               status = EXCLUDED.status,
               popular = EXCLUDED.popular,
               updated_at = NOW()`,
          [
            prodId,
            p.productId || prodId,
            p.productCode || '',
            name,
            category,
            p.serviceType || 'Broadband',
            p.speed || '',
            Number(p.monthlyPrice || p.price || 0),
            Number(p.installationFee || 0),
            p.description || '',
            JSON.stringify(Array.isArray(p.features) ? p.features : []),
            p.image || '',
            Number(p.availableQuantity ?? 999),
            p.status || 'active',
            Boolean(p.popular),
            p.createdAt || new Date(),
            p.updatedAt || new Date(),
          ]
        );
      }
      productsMigrated++;
    }
    console.log(` Migrated ${productsMigrated} catalog products.\n`);

    // -------------------------------------------------------------------------
    // 4. MIGRATE ESTABLISHED CONNECTIONS
    // -------------------------------------------------------------------------
    console.log('--- Step 4: Migrating Established Connections ---');
    const connectionsCollection = mongoDb.collection('connections');
    const mongoConnections = await connectionsCollection.find({}).toArray();
    console.log(`Found ${mongoConnections.length} connections in MongoDB.`);

    let connectionsMigrated = 0;
    for (const c of mongoConnections) {
      if (!c.telephone || !c.fullName || !c.nic) continue;
      const connId = mongoIdToUuid(c._id);

      if (!isDryRun) {
        await pgPool.query(
          `INSERT INTO connections (id, telephone, account_no, full_name, nic, contact_no, address_line1, address_line2, location, customer_type, email, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (telephone) DO UPDATE 
           SET full_name = EXCLUDED.full_name,
               nic = EXCLUDED.nic,
               contact_no = EXCLUDED.contact_no,
               address_line1 = EXCLUDED.address_line1,
               updated_at = NOW()`,
          [
            connId,
            c.telephone.trim(),
            c.accountNo ? c.accountNo.trim() : null,
            c.fullName.trim(),
            c.nic.toUpperCase().trim(),
            c.contactNo ? c.contactNo.trim() : '',
            c.addressLine1 || '',
            c.addressLine2 || '',
            JSON.stringify(c.location || {}),
            c.customerType || 'home',
            c.email || '',
            c.createdAt || new Date(),
            c.updatedAt || new Date(),
          ]
        );
      }
      connectionsMigrated++;
    }
    console.log(` Migrated ${connectionsMigrated} connections.\n`);

    // -------------------------------------------------------------------------
    // 5. MIGRATE APPLICATIONS (Sanitizing Dummy Prototyping Artifacts)
    // -------------------------------------------------------------------------
    console.log('--- Step 5: Migrating Applications (Sanitized) ---');
    const appsCollection = mongoDb.collection('applications');
    const mongoApps = await appsCollection.find({}).toArray();
    console.log(`Found ${mongoApps.length} applications in MongoDB.`);

    let appsMigrated = 0;
    let appsSkipped = 0;

    for (const a of mongoApps) {
      const ref = a.referenceNumber ? a.referenceNumber.trim() : '';
      const phone = a.phone ? a.phone.trim() : '';
      const nic = a.nic ? a.nic.toUpperCase().trim() : '';

      // Eliminate dead / test / incomplete prototyping data
      const isTestRef = /^TEST|^DUMMY/i.test(ref);
      const isInvalidPhone = !phone || phone === '0000000000' || phone.length < 9;
      const isInvalidNic = !nic || nic === 'TEST';
      const hasNoCustomerData = !a.formData && !a.documents;

      if (!ref || isTestRef || isInvalidPhone || isInvalidNic || hasNoCustomerData) {
        appsSkipped++;
        continue;
      }

      const appId = mongoIdToUuid(a._id);
      const actionedByUuid = a.actionedBy ? userIdMap.get(String(a.actionedBy)) || null : null;
      const salesOfficerUuid = a.salesOfficer ? userIdMap.get(String(a.salesOfficer)) || null : null;

      // Sanitize documents: strip huge inline base64 blobs from table storage
      let documents = a.documents || {};
      if (typeof documents === 'object') {
        const cleanDocs = {};
        for (const [k, v] of Object.entries(documents)) {
          if (typeof v === 'string' && v.startsWith('data:image/') && v.length > 50000) {
            cleanDocs[k] = `[base64-test-capture-omitted-${v.length}-bytes]`;
          } else {
            cleanDocs[k] = v;
          }
        }
        documents = cleanDocs;
      }

      if (!isDryRun) {
        await pgPool.query(
          `INSERT INTO applications (
            id, reference_number, phone, service_type, status, payment_status,
            payment_details, notes, actioned_by, actioned_at, nic, form_data,
            documents, office_fields, sales_officer_id, sales_officer_employee_number,
            sales_tracking_token, sales_attribution, completed_sale, completed_sale_at,
            created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
           ON CONFLICT (reference_number) DO NOTHING`,
          [
            appId,
            ref,
            phone,
            a.serviceType || 'new-connection',
            a.status || 'pending',
            a.paymentStatus || 'pending',
            JSON.stringify(a.paymentDetails || {}),
            a.notes || '',
            actionedByUuid,
            a.actionedAt || null,
            nic,
            JSON.stringify(a.formData || {}),
            JSON.stringify(documents),
            JSON.stringify(a.officeFields || {}),
            salesOfficerUuid,
            a.salesOfficerEmployeeNumber || null,
            a.salesTrackingToken || null,
            JSON.stringify(a.salesAttribution || {}),
            Boolean(a.completedSale),
            a.completedSaleAt || null,
            a.createdAt || new Date(),
            a.updatedAt || new Date(),
          ]
        );
      }
      appsMigrated++;
    }
    console.log(` Migrated ${appsMigrated} clean applications (skipped ${appsSkipped} test/dummy records).\n`);

    // -------------------------------------------------------------------------
    // 6. MIGRATE SALES OFFICER QRS
    // -------------------------------------------------------------------------
    console.log('--- Step 6: Migrating Sales Officer QR Records ---');
    const qrCollection = mongoDb.collection('salesofficerqrs');
    const mongoQrs = await qrCollection.find({}).toArray();
    console.log(`Found ${mongoQrs.length} QR records in MongoDB.`);

    let qrsMigrated = 0;
    for (const q of mongoQrs) {
      const officerUuid = q.officer ? userIdMap.get(String(q.officer)) : null;
      if (!officerUuid || !q.trackingToken || !q.employeeNumber) continue;

      const qrId = mongoIdToUuid(q._id);

      if (!isDryRun) {
        await pgPool.query(
          `INSERT INTO sales_officer_qrs (
            id, officer_id, employee_number, tracking_token, qr_url, is_active,
            scans_count, last_scanned_at, regenerated_at, previous_tokens, metadata,
            created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (officer_id) DO UPDATE 
           SET tracking_token = EXCLUDED.tracking_token,
               qr_url = EXCLUDED.qr_url,
               scans_count = EXCLUDED.scans_count,
               updated_at = NOW()`,
          [
            qrId,
            officerUuid,
            q.employeeNumber.trim(),
            q.trackingToken.trim(),
            q.qrUrl || '',
            q.isActive !== false,
            Number(q.scansCount || 0),
            q.lastScannedAt || null,
            q.regeneratedAt || null,
            JSON.stringify(q.previousTokens || []),
            JSON.stringify(q.metadata || {}),
            q.createdAt || new Date(),
            q.updatedAt || new Date(),
          ]
        );
      }
      qrsMigrated++;
    }
    console.log(` Migrated ${qrsMigrated} sales officer QR records.\n`);

    console.log('====================================================');
    console.log('🎉 ETL Migration Complete!');
    console.log('====================================================');
  } finally {
    await mongoClient.close();
    if (pgPool) {
      await pgPool.end();
    }
  }
}

runEtl().catch((err) => {
  console.error('❌ ETL Process failed with unhandled error:', err);
  process.exit(1);
});

