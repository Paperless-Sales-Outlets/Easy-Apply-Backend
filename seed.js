import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Connection from './models/Connection.js';

dotenv.config();

const seedDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/paperlessoutlet';
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB Connected for Seeding Connection Records');

    const sampleConnections = [
      {
        telephone: '0112345678',
        accountNo: 'ACC-8839120',
        fullName: 'Amarasiri Gunesekera',
        nic: '197523405678',
        contactNo: '0773456789',
        addressLine1: 'No 45, Lotus Road',
        addressLine2: 'Colombo 01',
        location: { lat: 6.9319, lng: 79.8478 },
        customerType: 'home',
        email: 'amarasiri@example.lk',
        status: 'active',
        packageName: '300 Mbps Fibre Broadband',
        speed: '300 Mbps',
        monthlyPrice: 6990,
      },
      {
        telephone: '0771234567',
        accountNo: 'ACC-001',
        fullName: 'Lionel Perera',
        nic: '198512345678',
        contactNo: '0771234567',
        addressLine1: 'No 12, Galle Road',
        addressLine2: 'Dehiwala',
        location: { lat: 6.8511, lng: 79.865 },
        customerType: 'home',
        email: 'lio.perera@example.lk',
        status: 'active',
        packageName: '300 Mbps Fibre Broadband',
        speed: '300 Mbps',
        monthlyPrice: 6990,
      },
      {
        telephone: '0112345678',
        accountNo: 'ACC-002',
        fullName: 'Lionel Perera',
        nic: '198512345678',
        contactNo: '0771234567',
        addressLine1: 'No 12, Galle Road',
        addressLine2: 'Dehiwala',
        location: { lat: 6.8511, lng: 79.865 },
        customerType: 'home',
        email: 'lio.perera@example.lk',
        status: 'active',
        packageName: 'Voice Home',
        speed: 'Voice',
        monthlyPrice: 990,
      },
      {
        telephone: '0712345678',
        accountNo: 'ACC-003',
        fullName: 'Lionel Perera',
        nic: '198512345678',
        contactNo: '0771234567',
        addressLine1: 'No 12, Galle Road',
        addressLine2: 'Dehiwala',
        location: { lat: 6.8511, lng: 79.865 },
        customerType: 'home',
        email: 'lio.perera@example.lk',
        status: 'active',
        packageName: 'LTE Home 150 GB',
        speed: '100 Mbps',
        monthlyPrice: 3999,
      },
      {
        telephone: '0774053185',
        accountNo: 'ACC-053185',
        fullName: 'Nimal Bandara',
        nic: '199105318522',
        contactNo: '0774053185',
        addressLine1: 'No 88, Kandy Road',
        addressLine2: 'Kiribathgoda',
        location: { lat: 6.981, lng: 79.929 },
        customerType: 'home',
        email: 'nimal.bandara@example.lk',
        status: 'active',
        packageName: '100 Mbps Fibre Family',
        speed: '100 Mbps',
        monthlyPrice: 3890,
      },
      {
        telephone: '0774053123',
        accountNo: 'ACC-053123',
        fullName: 'Sunethra Samarasinghe',
        nic: '198840531239',
        contactNo: '0774053123',
        addressLine1: 'No 24, Station Road',
        addressLine2: 'Nugegoda',
        location: { lat: 6.871, lng: 79.887 },
        customerType: 'home',
        email: 'sunethra.s@example.lk',
        status: 'active',
        packageName: 'Megaline Voice & Broadband',
        speed: 'Up to 16 Mbps',
        monthlyPrice: 2490,
      },
      {
        telephone: '0776768676',
        accountNo: 'ACC-678676',
        fullName: 'Kasun Jayawardena',
        nic: '199467686761',
        contactNo: '0776768676',
        addressLine1: 'No 155, Main Street',
        addressLine2: 'Battaramulla',
        location: { lat: 6.898, lng: 79.922 },
        customerType: 'office',
        email: 'kasun.j@example.lk',
        status: 'active',
        packageName: 'Fibre Flash 1 Gbps',
        speed: '1 Gbps',
        monthlyPrice: 14990,
      },
      {
        telephone: '0876543245',
        accountNo: 'ACC-543245',
        fullName: 'Dinesh Wickramasinghe',
        nic: '199287654324',
        contactNo: '0876543245',
        addressLine1: 'No 77, Beach Road',
        addressLine2: 'Negombo',
        location: { lat: 7.208, lng: 79.835 },
        customerType: 'home',
        email: 'dinesh.w@example.lk',
        status: 'active',
        packageName: '50 Mbps Fibre Lite',
        speed: '50 Mbps',
        monthlyPrice: 2890,
      },
      {
        telephone: '0111111111',
        accountNo: 'ACC-111111',
        fullName: 'Kamal Silva',
        nic: '198011111111',
        contactNo: '0111111111',
        addressLine1: 'No 1, High Level Road',
        addressLine2: 'Maharagama',
        location: { lat: 6.848, lng: 79.926 },
        customerType: 'home',
        email: 'kamal.silva@example.lk',
        status: 'active',
        packageName: '500 Mbps Fibre Ultra',
        speed: '500 Mbps',
        monthlyPrice: 9990,
      },
    ];

    for (const item of sampleConnections) {
      await Connection.deleteOne({ telephone: item.telephone });
      await Connection.create(item);
    }

    console.log(`Successfully seeded ${sampleConnections.length} connection records into MongoDB!`);
    process.exit(0);
  } catch (error) {
    console.error(`Error Seeding Connections: ${error.message}`);
    process.exit(1);
  }
};

seedDB();
