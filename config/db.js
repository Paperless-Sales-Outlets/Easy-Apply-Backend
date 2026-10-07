import 'dotenv/config';
import mongoose from 'mongoose';
import dns from 'node:dns';

// Configure DNS to use reliable public resolvers (resolves querySrv ECONNREFUSED from ISP/IPv6 DNS)
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch (err) {
  console.warn('⚠️ Could not set custom DNS servers:', err.message);
}

const RETRY_DELAY_MS = 15000;
const LOCAL_FALLBACK_URI = 'mongodb://127.0.0.1:27017/paperlessoutlet';

const isConnected = () => mongoose.connection.readyState === 1;

async function tryConnect(uri, label) {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    console.log(`MongoDB Connected: ${mongoose.connection.host} (${label})`);
    return true;
  } catch (error) {
    console.warn(`⚠️ ${label} connection failed: ${error.message}`);
    return false;
  }
}

// Connect to the primary Atlas database, falling back to a local MongoDB.
// Returns true when a database is available.
const connectDB = async () => {
  if (isConnected()) return true;

  if (process.env.MONGO_URI && (await tryConnect(process.env.MONGO_URI, 'Primary Atlas'))) {
    return true;
  }

  console.warn('Attempting local fallback...');
  if (await tryConnect(LOCAL_FALLBACK_URI, 'Local Fallback')) {
    return true;
  }

  console.error('⚠️ No database available. Retrying in the background...');
  scheduleRetry();
  return false;
};

function scheduleRetry() {
  setTimeout(async () => {
    try {
      if (isConnected()) return;
      if (process.env.MONGO_URI && (await tryConnect(process.env.MONGO_URI, 'Primary Atlas'))) return;
      console.warn('Retry: attempting local fallback...');
      if (await tryConnect(LOCAL_FALLBACK_URI, 'Local Fallback')) return;
      console.error('⚠️ Database still unavailable. Retrying again...');
      scheduleRetry();
    } catch (error) {
      console.error('⚠️ Background reconnect error:', error.message);
      scheduleRetry();
    }
  }, RETRY_DELAY_MS);
}

export const isDbConnected = isConnected;

export default connectDB;
