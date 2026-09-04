import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Connection from './models/Connection.js';
import Application from './models/Application.js';

dotenv.config();

const seedDB = async () => {
  try {
    const mongoUri =
      process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/paperlessoutlet';

    await mongoose.connect(mongoUri);

    console.log('MongoDB Connected for Seeding Connection Records');

    const sampleConnections = [
      // ==============================
      // Active Connections
      // ==============================

      {
        telephone: '0701234567',
        accountNo: 'SLT-2024-00847',
        fullName: 'Janith Perera',
        nic: '199012345678',
        contactNo: '0701234567',
        addressLine1: '42, Galle Road',
        addressLine2: 'Colombo 03',
        location: {
          lat: 6.9271,
          lng: 79.8612,
        },
        customerType: 'home',
        email: 'janithperera@email.com',
        status: 'active',
        packageName: 'Fibre Broadband 100 Mbps',
        speed: '100 Mbps',
        monthlyPrice: 1500,
        outstandingBalance: 0,
      },

      // ==============================
      // Email Testing Connections
      // ==============================
      {
        telephone: '0710001111',
        accountNo: 'EMAIL-TEST-001',
        fullName: 'Wehan Nimsara',
        nic: '199512345678',
        contactNo: '0710001111',
        addressLine1: 'Test Address 1',
        addressLine2: 'Colombo 03', // Colombo address for Loop Check
        location: {
          lat: 6.9271,
          lng: 79.8612,
        },
        customerType: 'home',
        email: 'wehannimsara@gmail.com',
        status: 'active',
        packageName: 'Fibre Broadband 100 Mbps',
        speed: '100 Mbps',
        monthlyPrice: 4490,
        outstandingBalance: 0,
      },
      {
        telephone: '0710002222',
        accountNo: 'EMAIL-TEST-002',
        fullName: 'Vehan Test',
        nic: '199512345679',
        contactNo: '0710002222',
        addressLine1: 'Test Address 2',
        addressLine2: 'Colombo 01', // Colombo address for Loop Check
        location: {
          lat: 6.9319,
          lng: 79.8478,
        },
        customerType: 'home',
        email: 'vehan0911@gmail.com',
        status: 'active',
        packageName: '300 Mbps Fibre Broadband',
        speed: '300 Mbps',
        monthlyPrice: 6990,
        outstandingBalance: 0,
      },


      {
        telephone: '0112345678',
        accountNo: 'ACC-8839120',
        fullName: 'Amarasiri Gunesekera',
        nic: '197523405678',
        contactNo: '0773456789',
        addressLine1: 'No 45, Lotus Road',
        addressLine2: 'Colombo 01',
        location: {
          lat: 6.9319,
          lng: 79.8478,
        },
        customerType: 'home',
        email: 'amarasiri@example.lk',
        status: 'active',
        packageName: '300 Mbps Fibre Broadband',
        speed: '300 Mbps',
        monthlyPrice: 6990,
        outstandingBalance: 0,
      },

      {
        telephone: '0771234567',
        accountNo: 'ACC-001',
        fullName: 'Lionel Perera',
        nic: '198512345678',
        contactNo: '0771234567',
        addressLine1: 'No 12, Galle Road',
        addressLine2: 'Dehiwala',
        location: {
          lat: 6.8511,
          lng: 79.865,
        },
        customerType: 'home',
        email: 'lio.perera@example.lk',
        status: 'active',
        packageName: '300 Mbps Fibre Broadband',
        speed: '300 Mbps',
        monthlyPrice: 6990,
        outstandingBalance: 0,
      },

      {
        telephone: '0112345677',
        accountNo: 'ACC-002',
        fullName: 'Lionel Perera',
        nic: '198512345678',
        contactNo: '0771234567',
        addressLine1: 'No 12, Galle Road',
        addressLine2: 'Dehiwala',
        location: {
          lat: 6.8511,
          lng: 79.865,
        },
        customerType: 'home',
        email: 'lio.perera@example.lk',
        status: 'active',
        packageName: 'Voice Home',
        speed: 'Voice',
        monthlyPrice: 990,
        outstandingBalance: 0,
      },

      {
        telephone: '0712345678',
        accountNo: 'ACC-003',
        fullName: 'Lionel Perera',
        nic: '198512345678',
        contactNo: '0771234567',
        addressLine1: 'No 12, Galle Road',
        addressLine2: 'Dehiwala',
        location: {
          lat: 6.8511,
          lng: 79.865,
        },
        customerType: 'home',
        email: 'lio.perera@example.lk',
        status: 'active',
        packageName: 'LTE Home 150 GB',
        speed: '100 Mbps',
        monthlyPrice: 3999,
        outstandingBalance: 0,
      },

      {
        telephone: '0774053185',
        accountNo: 'ACC-053185',
        fullName: 'Nimal Bandara',
        nic: '199105318522',
        contactNo: '0774053185',
        addressLine1: 'No 88, Kandy Road',
        addressLine2: 'Kiribathgoda',
        location: {
          lat: 6.981,
          lng: 79.929,
        },
        customerType: 'home',
        email: 'nimal.bandara@example.lk',
        status: 'active',
        packageName: '100 Mbps Fibre Family',
        speed: '100 Mbps',
        monthlyPrice: 3890,
        outstandingBalance: 0,
      },

      {
        telephone: '0774053123',
        accountNo: 'ACC-053123',
        fullName: 'Sunethra Samarasinghe',
        nic: '198840531239',
        contactNo: '0774053123',
        addressLine1: 'No 24, Station Road',
        addressLine2: 'Nugegoda',
        location: {
          lat: 6.871,
          lng: 79.887,
        },
        customerType: 'home',
        email: 'sunethra.s@example.lk',
        status: 'active',
        packageName: 'Megaline Voice & Broadband',
        speed: 'Up to 16 Mbps',
        monthlyPrice: 2490,
        outstandingBalance: 0,
      },

      {
        telephone: '0776768676',
        accountNo: 'ACC-678676',
        fullName: 'Kasun Jayawardena',
        nic: '199467686761',
        contactNo: '0776768676',
        addressLine1: 'No 155, Main Street',
        addressLine2: 'Battaramulla',
        location: {
          lat: 6.898,
          lng: 79.922,
        },
        customerType: 'office',
        email: 'kasun.j@example.lk',
        status: 'active',
        packageName: 'Fibre Flash 1 Gbps',
        speed: '1 Gbps',
        monthlyPrice: 14990,
        outstandingBalance: 0,
      },

      {
        telephone: '0876543245',
        accountNo: 'ACC-543245',
        fullName: 'Dinesh Wickramasinghe',
        nic: '199287654324',
        contactNo: '0876543245',
        addressLine1: 'No 77, Beach Road',
        addressLine2: 'Negombo',
        location: {
          lat: 7.208,
          lng: 79.835,
        },
        customerType: 'home',
        email: 'dinesh.w@example.lk',
        status: 'active',
        packageName: '50 Mbps Fibre Lite',
        speed: '50 Mbps',
        monthlyPrice: 2890,
        outstandingBalance: 0,
      },

      {
        telephone: '0111111111',
        accountNo: 'ACC-111111',
        fullName: 'Kamal Silva',
        nic: '198011111111',
        contactNo: '0111111111',
        addressLine1: 'No 1, High Level Road',
        addressLine2: 'Maharagama',
        location: {
          lat: 6.848,
          lng: 79.926,
        },
        customerType: 'home',
        email: 'kamal.silva@example.lk',
        status: 'active',
        packageName: '500 Mbps Fibre Ultra',
        speed: '500 Mbps',
        monthlyPrice: 9990,
        outstandingBalance: 0,
      },

      // ==============================
      // Disconnected Connections
      // ==============================

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
        outstandingBalance: 15000,
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
        outstandingBalance: 0,
      },

      {
        telephone: '0112345681',
        accountNo: '1111111111',
        fullName: 'Lionel Perera',
        nic: '198512345678',
        contactNo: '771234567',
        addressLine1: 'No 45, Lotus Road',
        addressLine2: 'Colombo 01',
        customerType: 'home',
        status: 'disconnected',
        outstandingBalance: 2500.5,
      },
    ];

    // Insert or update records without creating duplicates or unique index conflicts
    for (const connection of sampleConnections) {
      const query = connection.accountNo
        ? { $or: [{ accountNo: connection.accountNo }, { telephone: connection.telephone }] }
        : { telephone: connection.telephone };

      await Connection.updateOne(
        query,
        { $set: connection },
        { upsert: true }
      );
    }

    console.log(
      `Successfully seeded ${sampleConnections.length} connection records into MongoDB!`
    );

    // ==============================
    // Sample Applications (for Application History / status check testing)
    // ==============================
    const sampleApplications = [
      {
        seedId: 'seed-app-janith-1',
        phone: '0701234567',
        nic: '199012345678',
        serviceType: 'package-migration',
        status: 'approved',
        formData: { nameFull: 'Janith Perera', mobileNumber: '0701234567' },
      },
      {
        seedId: 'seed-app-janith-2',
        phone: '0701234567',
        nic: '199012345678',
        serviceType: 'refund-request',
        status: 'pending',
        formData: { nameFull: 'Janith Perera', mobileNumber: '0701234567' },
      },
      {
        seedId: 'seed-app-nimal-1',
        phone: '0774053185',
        nic: '199105318522',
        serviceType: 'reconnection',
        status: 'confirmed',
        formData: { nameFull: 'Nimal Bandara', mobileNumber: '0774053185' },
      },
      {
        seedId: 'seed-app-kasun-1',
        phone: '0776768676',
        nic: '199467686761',
        serviceType: 'termination',
        status: 'rejected',
        formData: { nameFull: 'Kasun Jayawardena', mobileNumber: '0776768676' },
      },
    ];

    let createdApplications = 0;
    for (const app of sampleApplications) {
      const { seedId, ...appData } = app;
      const existing = await Application.findOne({ 'formData.seedId': seedId });
      if (!existing) {
        await Application.create({
          ...appData,
          formData: { ...appData.formData, seedId },
        });
        createdApplications += 1;
      }
    }

    console.log(`Successfully seeded ${createdApplications} new application records into MongoDB!`);

    await mongoose.connection.close();

    console.log('MongoDB connection closed successfully.');

    process.exit(0);
  } catch (error) {
    console.error(`Error Seeding Connections: ${error.message}`);

    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }

    process.exit(1);
  }
};

seedDB();