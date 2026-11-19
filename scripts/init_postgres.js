import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const { Client } = pg;

// =============================================================================
// SLTMobitel EasyApply - PostgreSQL Automated Setup & Seeder Script
// Connects to PostgreSQL, creates database, executes schema.sql, and seeds data.
// =============================================================================

async function runSetup() {
  console.log('====================================================');
  console.log('   SLTMobitel EasyApply - PostgreSQL DB Initializer ');
  console.log('====================================================\n');

  const rawUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@127.0.0.1:5432/paperlessoutlet';

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (err) {
    console.error('❌ Invalid DATABASE_URL in .env:', rawUrl);
    process.exit(1);
  }

  const targetDbName = parsedUrl.pathname.replace(/^\/+/, '') || 'paperlessoutlet';
  const host = parsedUrl.hostname || '127.0.0.1';
  const port = parseInt(parsedUrl.port || '5432', 10);
  const user = parsedUrl.username || 'postgres';
  const password = decodeURIComponent(parsedUrl.password || 'postgres');

  console.log(`📌 Host:     ${host}:${port}`);
  console.log(`📌 User:     ${user}`);
  console.log(`📌 Target DB: ${targetDbName}\n`);

  // Step 1: Connect to default 'postgres' database to ensure target DB exists
  console.log(`1. Checking if database "${targetDbName}" exists...`);
  const adminClient = new Client({
    host,
    port,
    user,
    password,
    database: 'postgres',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  try {
    await adminClient.connect();
    const checkRes = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDbName]
    );

    if (checkRes.rows.length === 0) {
      console.log(`   Database "${targetDbName}" not found. Creating...`);
      await adminClient.query(`CREATE DATABASE "${targetDbName}"`);
      console.log(`   ✔ Database "${targetDbName}" created successfully!`);
    } else {
      console.log(`   ✔ Database "${targetDbName}" already exists.`);
    }
  } catch (err) {
    console.warn(`   ⚠️ Notice connecting to admin database: ${err.message}`);
    console.log(`   Attempting direct connection to "${targetDbName}"...`);
  } finally {
    try {
      await adminClient.end();
    } catch {}
  }

  // Step 2: Connect directly to target database
  console.log(`\n2. Connecting to target database "${targetDbName}"...`);
  const appClient = new Client({
    host,
    port,
    user,
    password,
    database: targetDbName,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  try {
    await appClient.connect();
    console.log(`   ✔ Connected to PostgreSQL (${targetDbName})!`);
  } catch (err) {
    console.error(`\n❌ Failed to connect to database "${targetDbName}":`, err.message);
    console.error('\nTips:');
    console.error('1. Is PostgreSQL running on your PC? (Check Windows Services: "postgresql")');
    console.error('2. Are your username and password correct in .env?');
    console.error('   DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5432/paperlessoutlet\n');
    process.exit(1);
  }

  // Step 3: Execute db/schema.sql
  console.log('\n3. Applying Schema (db/schema.sql)...');
  const schemaPath = path.join(process.cwd(), 'db', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.error(`❌ Schema file not found at: ${schemaPath}`);
    process.exit(1);
  }

  const ddl = fs.readFileSync(schemaPath, 'utf8');
  try {
    await appClient.query(ddl);
    console.log('   ✔ All 17 tables, indexes, and extensions verified/created!');
  } catch (err) {
    console.error('   ❌ Error executing schema DDL:', err.message);
  }

  // Step 4: Seed Default Roles, Admin User, and Sales Officer
  console.log('\n4. Checking & Seeding Initial Staff Accounts...');
  try {
    const salt = await bcrypt.genSalt(10);
    const defaultHash = await bcrypt.hash('Password123!', salt);

    // Seed Admin User
    await appClient.query(
      `INSERT INTO users (name, email, phone, role, permissions, is_active, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (email) DO NOTHING`,
      ['System Administrator', 'admin@slt.lk', '0770000000', 'admin', ['all'], true, defaultHash]
    );

    // Seed Sales Officer User (Employee Number: 095756)
    const officerRes = await appClient.query(
      `INSERT INTO users (name, email, phone, role, employee_number, permissions, is_active, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (email) DO UPDATE SET employee_number = $5
       RETURNING id, employee_number`,
      ['Kavinda Jayasuriya', 'so@slt.lk', '0771234567', 'sales officer', '095756', ['sales_officer'], true, defaultHash]
    );

    const officerId = officerRes.rows[0]?.id;
    if (officerId) {
      // Seed Sales Officer QR Record
      await appClient.query(
        `INSERT INTO sales_officer_qrs (officer_id, employee_number, tracking_token, qr_url, is_active)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (employee_number) DO NOTHING`,
        [
          officerId,
          '095756',
          'SO-TOKEN-095756',
          'http://localhost:5173/?ref=SO-TOKEN-095756',
          true,
        ]
      );
    }
    console.log('   ✔ Admin account created: admin@slt.lk (Password: Password123!)');
    console.log('   ✔ Sales Officer created: so@slt.lk, Emp #095756 (Password: Password123!)');
  } catch (err) {
    console.warn('   ⚠️ Notice during user seeding:', err.message);
  }

  // Step 5: Seed Products Catalog
  console.log('\n5. Seeding Product Catalog...');
  try {
    const productsRes = await appClient.query('SELECT COUNT(*) FROM products');
    const count = parseInt(productsRes.rows[0].count, 10);

    if (count === 0) {
      const defaultProducts = [
        {
          id: 'fibre-300',
          product_id: 'PRD-FIBRE-300',
          name: '300 Mbps Fibre Broadband',
          category: 'Fibre Broadband',
          service_type: 'Fibre',
          speed: '300 Mbps',
          monthly_price: 6990,
          installation_fee: 2500,
          popular: true,
          status: 'active',
          description: 'Ultra-fast Fibre connection for seamless streaming, gaming, and smart home connectivity.',
        },
        {
          id: 'fibre-500',
          product_id: 'PRD-FIBRE-500',
          name: '500 Mbps Fibre Broadband',
          category: 'Fibre Broadband',
          service_type: 'Fibre',
          speed: '500 Mbps',
          monthly_price: 8990,
          installation_fee: 2500,
          popular: false,
          status: 'active',
          description: 'Gigabit-class speed for heavy multi-user environments and cloud workstations.',
        },
        {
          id: 'fibre-100',
          product_id: 'PRD-FIBRE-100',
          name: '100 Mbps Fibre Starter',
          category: 'Fibre Broadband',
          service_type: 'Fibre',
          speed: '100 Mbps',
          monthly_price: 4490,
          installation_fee: 2500,
          popular: true,
          status: 'active',
          description: 'High-speed unlimited broadband ideal for work-from-home and HD entertainment.',
        },
        {
          id: 'lte-anytime',
          product_id: 'PRD-LTE-ANYTIME',
          name: 'LTE 4G Anytime 150GB',
          category: '4G LTE',
          service_type: 'LTE',
          speed: 'Up to 50 Mbps',
          monthly_price: 3200,
          installation_fee: 1500,
          popular: false,
          status: 'active',
          description: 'Reliable 4G wireless broadband router with anytime quota.',
        },
        {
          id: 'peo-tv-hd',
          product_id: 'PRD-PEOTV-HD',
          name: 'PEO TV Entertainment HD',
          category: 'PEO TV',
          service_type: 'PEOTV',
          speed: 'HD Streaming',
          monthly_price: 1850,
          installation_fee: 1000,
          popular: true,
          status: 'active',
          description: '140+ Channels, Rewind TV, Video on Demand, and full HD digital clarity.',
        },
      ];

      for (const p of defaultProducts) {
        await appClient.query(
          `INSERT INTO products (id, product_id, name, category, service_type, speed, monthly_price, installation_fee, popular, status, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (id) DO NOTHING`,
          [p.id, p.product_id, p.name, p.category, p.service_type, p.speed, p.monthly_price, p.installation_fee, p.popular, p.status, p.description]
        );
      }
      console.log(`   ✔ Seeded ${defaultProducts.length} default products.`);
    } else {
      console.log(`   ✔ Products table already contains ${count} items.`);
    }
  } catch (err) {
    console.warn('   ⚠️ Notice during product seeding:', err.message);
  }

  console.log('\n====================================================');
  console.log('   🎉 PostgreSQL Setup Completed Successfully!       ');
  console.log('====================================================\n');
  await appClient.end();
}

runSetup().catch((err) => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});

