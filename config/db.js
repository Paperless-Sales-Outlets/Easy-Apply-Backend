import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// Automatic SSL detection for cloud (Supabase) vs on-prem / local PostgreSQL
function determineSslConfig() {
  if (process.env.DATABASE_SSL === 'false') return false;
  if (process.env.DATABASE_SSL === 'true') return { rejectUnauthorized: false };

  const url = process.env.DATABASE_URL || '';
  if (
    url.includes('sslmode=') ||
    url.includes('.supabase.co') ||
    url.includes('.supabase.com') ||
    url.includes('pooler.supabase.com')
  ) {
    return { rejectUnauthorized: false };
  }
  return false;
}

let rawConnectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URI ||
  'postgresql://postgres:postgres@127.0.0.1:5432/paperlessoutlet';

// If password contains unencoded @ signs before the host, handle gracefully, and remove sslmode query param
// so pg's strict SSL parser doesn't conflict with rejectUnauthorized: false
let connectionString = rawConnectionString;
if (connectionString.includes('sslmode=')) {
  connectionString = connectionString.replace(/[?&]sslmode=[^&]+/g, '');
  if (!connectionString.includes('?') && connectionString.includes('&')) {
    connectionString = connectionString.replace('&', '?');
  }
}

export const pool = new Pool({
  connectionString,
  ssl: determineSslConfig(),
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

let isConnected = false;

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err.message);
});

// Test and establish connection on startup
export const connectDB = async () => {
  try {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT NOW() as now, current_database() as db');
      isConnected = true;
      console.log(`PostgreSQL Connected: database "${res.rows[0].db}" at ${res.rows[0].now}`);
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    isConnected = false;
    console.warn(`PostgreSQL connection failed: ${error.message}`);
    scheduleRetry();
    return false;
  }
};

const RETRY_DELAY_MS = 15000;
function scheduleRetry() {
  setTimeout(async () => {
    try {
      if (isConnected) return;
      const client = await pool.connect();
      client.release();
      isConnected = true;
      console.log('PostgreSQL Connected successfully on retry.');
    } catch (err) {
      console.warn(`PostgreSQL retry failed: ${err.message}. Retrying in ${RETRY_DELAY_MS / 1000}s...`);
      scheduleRetry();
    }
  }, RETRY_DELAY_MS);
}

export const isDbConnected = () => isConnected;

// Execute parameterized SQL query
export async function query(text, params = []) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production' && duration > 500) {
    console.warn(`Slow SQL query (${duration}ms):`, text);
  }
  return res;
}

// Transaction execution wrapper
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Map snake_case SQL row columns to camelCase for React frontend compatibility
export function toCamelCase(row) {
  if (!row || typeof row !== 'object') return row;
  if (Array.isArray(row)) return row.map(toCamelCase);

  const camel = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z0-9])/g, (_, g) => g.toUpperCase());
    
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      camel[camelKey] = toCamelCase(value);
    } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && !(value[0] instanceof Date)) {
      camel[camelKey] = value.map(toCamelCase);
    } else {
      camel[camelKey] = value;
    }
  }

  if (camel.id && !camel._id) camel._id = camel.id;
  if (camel._id && !camel.id) camel.id = camel._id;

  return camel;
}

export default connectDB;
