// Throwaway: inspects the admin/staff accounts and their password state.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User from './models/User.js';

dotenv.config({ path: path.resolve('.env') });

if (!process.env.MONGO_URI) {
  console.log('MONGO_URI is not set in .env');
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI);
console.log('connected');

const all = await User.find({}).select('+password').lean();
console.log('total users:', all.length);

const byRole = all.reduce((acc, u) => {
  acc[u.role] = (acc[u.role] || 0) + 1;
  return acc;
}, {});
console.log('by role:', byRole);

const staffish = all.filter(u => u.role !== 'Customer');
console.log('\n--- non-customer accounts ---');
for (const u of staffish) {
  console.log(
    [
      'name=' + JSON.stringify(u.name),
      'email=' + JSON.stringify(u.email),
      'phone=' + JSON.stringify(u.phone),
      'role=' + u.role,
      'hasPassword=' + (u.password ? 'YES' : 'NO'),
      'hashPrefix=' + (u.password ? String(u.password).slice(0, 7) : 'n/a'),
    ].join('  ')
  );
}

const admins = all.filter(u => u.role === 'Admin');
console.log('\nadmin emails:', admins.map(a => JSON.stringify(a.email)));
console.log('admins WITH password:', admins.filter(a => a.password).length, '/', admins.length);

if (admins.length && !admins.some(a => a.password)) {
  console.log('\n>> Every Admin account has no password, so email+password login can never succeed for them.');
}

await mongoose.connection.close();
