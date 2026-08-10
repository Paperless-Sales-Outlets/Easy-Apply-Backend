import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.warn(`⚠️ Primary MongoDB Connection Failed: ${error.message}. Attempting local fallback...`);
    try {
      const conn = await mongoose.connect('mongodb://127.0.0.1:27017/paperlessoutlet', { serverSelectionTimeoutMS: 5000 });
      console.log(`MongoDB Connected (Local Fallback): ${conn.connection.host}`);
    } catch (localErr) {
      console.error(`⚠️ Local MongoDB Connection Failed: ${localErr.message}`);
      console.error('   Continuing server operation.');
    }
  }
};

export default connectDB;


