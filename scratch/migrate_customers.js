import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Customer from '../models/Customer.js';
import RefreshToken from '../models/RefreshToken.js';

dotenv.config();

const applyMigration = process.argv.includes('--apply');
const rolesArgument = process.argv.find((argument) => argument.startsWith('--roles='));
const customerRoles = rolesArgument
  ? rolesArgument.slice('--roles='.length).split(',').map((role) => role.trim()).filter(Boolean)
  : ['Customer', 'User'];

const migrateCustomers = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not defined in .env');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const customerUsers = await User.find({ role: { $in: customerRoles } })
    .select('+password')
    .lean();

  console.log(`${applyMigration ? 'Applying' : 'Dry run'}: ${customerUsers.length} customer record(s) found in users for roles: ${customerRoles.join(', ')}.`);

  for (const user of customerUsers) {
    const existingCustomer = await Customer.findOne({
      $or: [{ phone: user.phone }, { NIC: user.NIC }],
    }).lean();

    if (existingCustomer) {
      console.log(`SKIP ${user._id}: customers record already exists for ${user.phone || user.NIC}`);
      continue;
    }

    console.log(`${applyMigration ? 'MOVE' : 'WOULD MOVE'} ${user._id}: ${user.phone} (${user.NIC})`);

    if (!applyMigration) continue;

    const { role, _id, ...customerData } = user;
    await Customer.collection.insertOne({
      ...customerData,
      _id,
      createdAt: user.createdAt || new Date(),
      updatedAt: user.updatedAt || new Date(),
    });

    await RefreshToken.updateMany(
      { userId: _id },
      { $set: { accountType: 'Customer' } }
    );

    await User.deleteOne({ _id, role: { $in: customerRoles } });
  }

  if (!applyMigration) {
    console.log('No data was changed. Re-run with --apply after reviewing the records above.');
  }
};

migrateCustomers()
  .catch((error) => {
    console.error('Customer migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });