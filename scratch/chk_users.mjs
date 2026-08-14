import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
await mongoose.connect(process.env.MONGO_URI);
const u = await mongoose.connection.collection('users').find({}).project({ name: 1, email: 1, role: 1 }).limit(10).toArray();
console.log('USERS:', JSON.stringify(u));
await mongoose.disconnect();
