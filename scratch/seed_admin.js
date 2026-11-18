import dotenv from 'dotenv';
import path from 'path';
import connectDB from '../config/db.js';
import User from '../models/User.js';

// Load .env configuration
dotenv.config({ path: path.resolve('.env') });

const seedAdmin = async () => {
  try {
    await connectDB();
    console.log('PostgreSQL Connected successfully.');

    const email = 'admin@slt.lk';
    const exists = await User.findOne({ email });

    if (exists) {
      exists.password = 'admin123';
      await exists.save();
      console.log(`\nAdmin account exists and password updated:`);
      console.log(`Email:    ${email}`);
      console.log(`Password: admin123`);
    } else {
      await User.create({
        name: 'EasyApply Admin',
        email,
        password: 'admin123',
        role: 'Admin',
      });
      console.log(`\nAdmin account created successfully!`);
      console.log(`Email:    ${email}`);
      console.log(`Password: admin123`);
    }
  } catch (error) {
    console.error('Error seeding admin user:', error.message);
  } finally {
    process.exit(0);
  }
};

seedAdmin();
