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

    // Create a dummy record based on Sri Lanka
    const dummyConnection = {
      telephone: '0112345678',
      fullName: 'Lionel Perera',
      nic: '198512345678',
      contactNo: '0771234567',
      addressLine1: 'No 45, Lotus Road',
      addressLine2: 'Colombo 01',
      location: {
        lat: 6.9319,
        lng: 79.8478
      },
      customerType: 'home',
      email: 'lio.perera@example.lk',
      status: 'disconnected',
      disconnectedFrom: '2023-01-15',
      disconnectedTo: '2023-10-15',
      outstandingBalance: 2500.50,
      broadbandUsername: 'lio.perera@sltbb'
    };

    // Check if it exists and delete it to prevent duplicates
    await Connection.deleteOne({ telephone: dummyConnection.telephone });

    // Insert the new record
    await Connection.create(dummyConnection);
    console.log('Dummy Connection record inserted successfully!');

    process.exit();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

seedDB();
