import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';

dotenv.config();

// Fix for Windows / Node SRV lookup issue on some ISP / local DNS servers
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (e) {
  // Ignore if custom DNS cannot be set
}

const RETRY_DELAY_MS = 15000;
const DEFAULT_LOCAL_URI = 'mongodb://127.0.0.1:27017/paperlessoutlet';

const isConnected = () => mongoose.connection.readyState === 1;

async function tryConnect(uri, label, timeoutMs = 4000) {
  if (!uri) return false;
  try {
    await mongoose.connect(uri, { 
      serverSelectionTimeoutMS: timeoutMs,
      connectTimeoutMS: timeoutMs 
    });
    console.log(`✅ MongoDB Connected: ${mongoose.connection.host} (${label})`);
    return true;
  } catch (error) {
    const errorMsg = error.code || error.message?.split('\n')[0] || 'Unknown error';
    console.warn(`⚠️ ${label} connection failed: ${errorMsg}`);
    return false;
  }
}

/**
 * Connect to MongoDB:
 * 1. Always tries MongoDB Atlas first.
 * 2. If Atlas fails, automatically falls back to local MongoDB Compass.
 * 3. Keeps trying in the background if all connections fail.
 */
const connectDB = async () => {
  if (isConnected()) return true;

  const atlasUri = process.env.MONGO_URI || process.env.ATLAS_MONGO_URI;
  const localUri = process.env.LOCAL_MONGO_URI || DEFAULT_LOCAL_URI;

  // 1. Always try MongoDB Atlas first
  if (atlasUri && !atlasUri.includes('127.0.0.1') && !atlasUri.includes('localhost')) {
    console.log('📡 Connecting to MongoDB Atlas...');
    const atlasConnected = await tryConnect(atlasUri, 'MongoDB Atlas', 4000);
    if (atlasConnected) {
      return true;
    }
    console.log('🔄 Atlas unavailable. Falling back to local MongoDB (Compass)...');
  }

  // 2. Fallback to Local MongoDB (Compass)
  const localConnected = await tryConnect(localUri, 'Local MongoDB (Compass)', 3000);
  if (localConnected) {
    return true;
  }

  console.error('❌ Both Atlas and Local MongoDB connections failed. Retrying in background...');
  scheduleRetry();
  return false;
};

function scheduleRetry() {
  setTimeout(async () => {
    try {
      if (isConnected()) return;
      const success = await connectDB();
      if (!success) {
        scheduleRetry();
      }
    } catch (error) {
      console.error('⚠️ Background reconnect error:', error.message);
      scheduleRetry();
    }
  }, RETRY_DELAY_MS);
}

// Lifecycle listeners
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB connection lost. Attempting to restore connection...');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB connection re-established.');
});

export const isDbConnected = isConnected;
export default connectDB;


