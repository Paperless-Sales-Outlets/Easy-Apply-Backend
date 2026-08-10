import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './models/Product.js';

dotenv.config();

const sampleProducts = [
  {
    name: '300 Mbps Fibre Broadband',
    category: 'Fibre Broadband',
    serviceType: 'Fibre',
    speed: '300 Mbps',
    monthlyPrice: 6990,
    installationFee: 2500,
    description: 'Perfect for streaming, gaming and smart homes. Ideal for families and professionals who need high speed and reliable connectivity.',
    features: [
      'Ultra-fast speed',
      'Unlimited data',
      'Free installation',
      'Wi-Fi Router'
    ],
    image: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=600&q=80',
    popular: true,
    status: 'active'
  },
  {
    name: '500 Mbps Fibre Broadband',
    category: 'Fibre Broadband',
    serviceType: 'Fibre',
    speed: '500 Mbps',
    monthlyPrice: 8990,
    installationFee: 2500,
    description: 'Ideal for smart homes, multi-device 4K streaming and heavy gaming workloads.',
    features: [
      'Ideal for smart homes',
      'Unlimited data',
      'Free installation',
      'Wi-Fi Router'
    ],
    image: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=600&q=80',
    popular: true,
    status: 'active'
  },
  {
    name: '1 Gbps Fibre Broadband',
    category: 'Fibre Broadband',
    serviceType: 'Fibre',
    speed: '1 Gbps',
    monthlyPrice: 12990,
    installationFee: 2500,
    description: 'Superfast downloads for heavy data users, digital creators, and smart homes.',
    features: [
      'Superfast downloads',
      'Unlimited data',
      'Free installation',
      'Wi-Fi Router'
    ],
    image: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=600&q=80',
    popular: false,
    status: 'active'
  },
  {
    name: 'LTE Home 150 GB',
    category: 'LTE Home',
    serviceType: 'LTE',
    speed: 'Up to 100 Mbps',
    monthlyPrice: 4490,
    installationFee: 1500,
    description: 'High speed wireless internet with 150GB anytime data for reliable home connectivity.',
    features: [
      'High speed internet',
      '150GB anytime data',
      'Easy self installation'
    ],
    image: 'https://images.unsplash.com/photo-1563770660941-20978e870e26?auto=format&fit=crop&w=600&q=80',
    popular: false,
    status: 'active'
  },
  {
    name: 'LTE Home 300 GB',
    category: 'LTE Home',
    serviceType: 'LTE',
    speed: 'Up to 100 Mbps',
    monthlyPrice: 6490,
    installationFee: 1500,
    description: 'High speed wireless internet with 300GB anytime data for family entertainment.',
    features: [
      'High speed internet',
      '300GB anytime data',
      'Easy self installation'
    ],
    image: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=600&q=80',
    popular: false,
    status: 'active'
  },
  {
    name: 'PEO TV Starter Pack',
    category: 'PEO TV',
    serviceType: 'PEO TV',
    speed: 'HD Quality',
    monthlyPrice: 1999,
    installationFee: 1000,
    description: '100+ TV Channels with On-Demand features and 7-day Catch-up TV functionality.',
    features: [
      '100+ TV Channels',
      'On Demand',
      'Catch-up TV'
    ],
    image: 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=600&q=80',
    popular: false,
    status: 'active'
  },
  {
    name: 'Voice Home Phone',
    category: 'Voice',
    serviceType: 'Voice',
    speed: 'HD Voice',
    monthlyPrice: 499,
    installationFee: 0,
    description: 'Crystal clear landline voice connection with reliable calls and number preservation.',
    features: [
      'Crystal clear calls',
      'Reliable connection',
      'Keep your number'
    ],
    image: 'https://images.unsplash.com/photo-1520923642038-b4259acecbd7?auto=format&fit=crop&w=600&q=80',
    popular: false,
    status: 'active'
  },
  {
    name: 'Add-on Static IP',
    category: 'Add-ons',
    serviceType: 'Addon',
    speed: 'High Performance',
    monthlyPrice: 1000,
    installationFee: 0,
    description: 'Dedicated IP address for enhanced security, remote hosting, and better performance.',
    features: [
      'Dedicated IP address',
      'Enhanced security',
      'Better performance'
    ],
    image: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=600&q=80',
    popular: false,
    status: 'active'
  }
];


const seedProducts = async () => {
  let connected = false;
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/paperlessoutlet';

  try {
    console.log(`Connecting to MongoDB at: ${mongoUri.split('@').pop()}...`);
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    connected = true;
  } catch (err) {
    console.warn(`Primary connection failed (${err.message}). Trying fallback local connection...`);
    try {
      await mongoose.connect('mongodb://127.0.0.1:27017/paperlessoutlet', { serverSelectionTimeoutMS: 5000 });
      connected = true;
      console.log('Connected to local MongoDB instance.');
    } catch (localErr) {
      console.error('Local MongoDB connection also failed:', localErr.message);
    }
  }

  if (!connected) {
    console.error('Could not establish database connection for seeding.');
    process.exit(1);
  }

  try {
    await Product.deleteMany({});
    console.log('Cleared existing product records.');

    const createdProducts = await Product.insertMany(sampleProducts);
    console.log(`Successfully seeded ${createdProducts.length} products to MongoDB!`);

    process.exit(0);
  } catch (error) {
    console.error('Error seeding products:', error);
    process.exit(1);
  }
};

seedProducts();

