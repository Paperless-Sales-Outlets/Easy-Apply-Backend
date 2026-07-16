import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User from '../models/User.js';

// Load .env configuration
dotenv.config({ path: path.resolve('.env') });

const seedAdmin = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is not defined in your .env file');
    }
    
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected successfully.');

    const email = 'admin@slt.lk';
    const exists = await User.findOne({ email });

    if (exists) {
      console.log(`\nAdmin account already exists:`);
      console.log(`Email:    ${email}`);
      console.log(`Password: admin123`);
    } else {
      await User.create({
        name: 'EasyApply Admin',
        email,
        phone: '0112345678',
        NIC: '990000000V',
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
    await mongoose.connection.close();
    console.log('Database connection closed.');
  }
};

seedAdmin();
