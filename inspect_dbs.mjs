// Throwaway: which database are we pointed at, and do any others hold users?
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User from './models/User.js';

dotenv.config({ path: path.resolve('.env') });

const uri = process.env.MONGO_URI || '';
// Print only the database name, never the credentials.
const dbName = uri.replace(/^.*\/\/[^/]*\//, '').replace(/\?.*$/, '');
console.log('MONGO_URI database name:', JSON.stringify(dbName));

await mongoose.connect(uri);
const admin = mongoose.connection.db.admin();

const { databases } = await admin.listDatabases();
console.log('databases on this server:', databases.map(d => `${d.name} (${d.sizeOnDisk} bytes)`).join(', '));

for (const d of databases) {
  if (d.name === 'admin' || d.name === 'config' || d.name === 'local') continue;
  const conn = mongoose.createConnection(uri.replace(/\/[^/]*(\?|$)/, `/${d.name}$1`));
  try {
    await conn.asPromise();
    const count = await conn.db.collection('users').countDocuments();
    const sample = await conn.db.collection('users').find({}, { projection: { name: 1, email: 1, phone: 1, role: 1 } }).limit(5).toArray();
    console.log(`\n${d.name}: users=${count}`);
    sample.forEach(u => console.log('   ', JSON.stringify(u)));
    await conn.close();
  } catch (err) {
    console.log(`\n${d.name}: could not inspect (${err.message})`);
    await conn.close().catch(() => {});
  }
}

await mongoose.connection.close();
