import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Connection from './models/Connection.js';

dotenv.config();

const seedDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB Connected');

    // Create 3 dummy records based on Sri Lanka
    const dummyConnections = [
      {
        telephone: '0112345678',
        accountNo: '1111111111',
        fullName: 'Lionel Perera',
        nic: '198512345678',
        contactNo: '771234567',
        addressLine1: 'No 45, Lotus Road',
        addressLine2: 'Colombo 01',
        customerType: 'home',
        status: 'disconnected',
        outstandingBalance: 2500.50,
      },
      {
        telephone: '0112345679',
        accountNo: '2222222222',
        fullName: 'Lionel Perera',
        nic: '198512345678',
        contactNo: '771234567',
        addressLine1: 'Level 5, World Trade Center',
        addressLine2: 'Colombo 01',
        customerType: 'office',
        status: 'disconnected',
        outstandingBalance: 15000.00,
      },
      {
        telephone: '0112345680',
        accountNo: '3333333333',
        fullName: 'Lionel Perera',
        nic: '198512345678',
        contactNo: '771234567',
        addressLine1: 'No 12, Galle Road',
        addressLine2: 'Mount Lavinia',
        customerType: 'home',
        status: 'disconnected',
        outstandingBalance: 0.00,
      }
    ];

    // Check if they exist and delete them to prevent duplicates
    await Connection.deleteMany({ contactNo: '771234567' });

    // Insert the new records
    await Connection.insertMany(dummyConnections);
    console.log('Dummy Connection records inserted successfully!');

    process.exit();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

seedDB();
