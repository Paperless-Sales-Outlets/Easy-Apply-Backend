import connectDB, { query } from './config/db.js';
import dotenv from 'dotenv';
import Product from './models/Product.js';

dotenv.config();

export const demoProducts = [
  // ── 🌐 Fibre Broadband Packages ──
  {
    id: 'prod-fbb-100',
    productId: 'prod-fbb-100',
    productCode: 'SLT-FBB-100',
    name: 'Fibre Broadband 100 Mbps',
    category: 'Fibre Broadband',
    serviceType: 'Broadband',
    speed: '100 Mbps',
    monthlyPrice: 4490,
    installationFee: 0,
    description: 'High-speed symmetric fibre connection for seamless streaming, remote work, and home connectivity.',
    features: [
      '100 Mbps Download & Upload',
      'Unlimited Anytime Data',
      'Free Standard Installation',
      'Dual-Band Wi-Fi Router Included',
      '24/7 Priority Technical Support',
    ],
    image: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=600&q=80',
    popular: true,
    status: 'active',
    availableQuantity: 999,
  },
  {
    id: 'prod-fbb-200',
    productId: 'prod-fbb-200',
    productCode: 'SLT-FBB-200',
    name: 'Fibre Broadband 200 Mbps',
    category: 'Fibre Broadband',
    serviceType: 'Broadband',
    speed: '200 Mbps',
    monthlyPrice: 6990,
    installationFee: 0,
    description: 'Blazing fast speeds engineered for power users, competitive gaming, 4K multi-screen streaming, and smart home ecosystems.',
    features: [
      '200 Mbps Download & Upload',
      'Unlimited Anytime Data',
      'Free Express Setup',
      'Wi-Fi 6 Router Included',
      '24/7 Dedicated Support',
    ],
    image: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=600&q=80',
    popular: true,
    status: 'active',
    availableQuantity: 999,
  },
  {
    id: 'prod-fbb-300',
    productId: 'prod-fbb-300',
    productCode: 'SLT-FBB-300',
    name: 'Fibre Broadband 300 Mbps',
    category: 'Fibre Broadband',
    serviceType: 'Broadband',
    speed: '300 Mbps',
    monthlyPrice: 8490,
    installationFee: 0,
    description: 'Heavy workload bandwidth for smart homes, digital creators, video editing, and simultaneous multi-user gaming.',
    features: [
      '300 Mbps Download & Upload',
      'Unlimited Anytime Data',
      'Free Standard Installation',
      'Premium Dual-Band Gigabit ONT',
      'Low Latency Gaming Route',
    ],
    image: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=600&q=80',
    popular: false,
    status: 'active',
    availableQuantity: 999,
  },
  {
    id: 'prod-fbb-500',
    productId: 'prod-fbb-500',
    productCode: 'SLT-FBB-500',
    name: 'Fibre Broadband 500 Mbps',
    category: 'Fibre Broadband',
    serviceType: 'Broadband',
    speed: '500 Mbps',
    monthlyPrice: 9990,
    installationFee: 0,
    description: 'Gigabit-class performance for power households and home studios demanding instantaneous uploads and downloads.',
    features: [
      '500 Mbps Symmetric Fibre',
      'Unlimited Anytime Data',
      'Free Express Installation',
      'Wi-Fi 6E Mesh Ready Router',
      'VIP Concierge Support',
    ],
    image: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=600&q=80',
    popular: false,
    status: 'active',
    availableQuantity: 999,
  },
  {
    id: 'prod-fbb-1g',
    productId: 'prod-fbb-1g',
    productCode: 'SLT-FBB-1000',
    name: 'Fibre Broadband 1 Gbps',
    category: 'Fibre Broadband',
    serviceType: 'Broadband',
    speed: '1 Gbps',
    monthlyPrice: 14990,
    installationFee: 0,
    description: 'The pinnacle of residential internet with true 1,000 Mbps throughput for ultimate speed and uncompromised bandwidth.',
    features: [
      '1,000 Mbps Ultra Throughput',
      'Unlimited High-Speed Data',
      'Free White-Glove Installation',
      'Enterprise Wi-Fi 6 Gateway',
      'Dedicated SLA Support',
    ],
    image: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=600&q=80',
    popular: false,
    status: 'active',
    availableQuantity: 999,
  },

  // ── 📡 LTE Wireless Broadband Packages ──
  {
    id: 'prod-lte-150',
    productId: 'prod-lte-150',
    productCode: 'SLT-LTE-150',
    name: 'LTE Home 150 GB',
    category: 'LTE Home',
    serviceType: 'Broadband',
    speed: 'Up to 100 Mbps',
    monthlyPrice: 3990,
    installationFee: 1500,
    description: 'Instant wireless 4G connectivity across Sri Lanka without needing physical landlines. Plug and play right out of the box.',
    features: [
      '150 GB Monthly Anytime Data',
      'Speeds up to 100 Mbps',
      'Plug & Play 4G Wireless Router',
      'No Physical Line Required',
      'Islandwide 4G LTE Coverage',
    ],
    image: 'https://images.unsplash.com/photo-1563770660941-20978e870e26?auto=format&fit=crop&w=600&q=80',
    popular: false,
    status: 'active',
    availableQuantity: 999,
  },
  {
    id: 'prod-lte-300',
    productId: 'prod-lte-300',
    productCode: 'SLT-LTE-300',
    name: 'LTE Home 300 GB',
    category: 'LTE Home',
    serviceType: 'Broadband',
    speed: 'Up to 100 Mbps',
    monthlyPrice: 5990,
    installationFee: 1500,
    description: 'Heavy quota wireless internet for family entertainment, online schooling, and remote work.',
    features: [
      '300 GB Monthly Anytime Data',
      'High-Speed 4G LTE Connectivity',
      'Dual-Band LTE Router Included',
      'Instant Activation',
      '24/7 Customer Care',
    ],
    image: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=600&q=80',
    popular: false,
    status: 'active',
    availableQuantity: 999,
  },

  // ── 📞 Voice Packages ──
  {
    id: 'prod-voice-home',
    productId: 'prod-voice-home',
    productCode: 'SLT-VOICE-HOME',
    name: 'Fibre Voice Home (MyPhone)',
    category: 'Voice',
    serviceType: 'Voice',
    speed: 'Voice',
    monthlyPrice: 890,
    installationFee: 0,
    description: 'Crystal-clear digital telephone service over fibre with unlimited local SLT calling and smart call handling features.',
    features: [
      'Unlimited Local SLT Calls',
      'Crystal Clear HD Audio',
      'Free Caller ID & Call Waiting',
      'Discounted IDD Rates',
      'Number Preservation Support',
    ],
    image: 'https://images.unsplash.com/photo-1520923642038-b4259acecbd7?auto=format&fit=crop&w=600&q=80',
    popular: true,
    status: 'active',
    availableQuantity: 999,
  },
  {
    id: 'prod-voice-unlimited',
    productId: 'prod-voice-unlimited',
    productCode: 'SLT-VOICE-UNL',
    name: 'Voice Unlimited Prime',
    category: 'Voice',
    serviceType: 'Voice',
    speed: 'Voice',
    monthlyPrice: 1490,
    installationFee: 0,
    description: 'Comprehensive fixed voice package designed for frequent callers with unlimited calls across all domestic networks.',
    features: [
      'Unlimited Local Calls to Any Network',
      'Free Value-Added Features Pack',
      'Call Forwarding & Conference Calling',
      'Premium Priority Landline Support',
    ],
    image: 'https://images.unsplash.com/photo-1534536281715-e28d76689b4d?auto=format&fit=crop&w=600&q=80',
    popular: false,
    status: 'active',
    availableQuantity: 999,
  },
  {
    id: 'prod-voice-megaline',
    productId: 'prod-voice-megaline',
    productCode: 'SLT-VOICE-MEGA',
    name: 'Megaline Voice Landline',
    category: 'Voice',
    serviceType: 'Voice',
    speed: 'Voice',
    monthlyPrice: 690,
    installationFee: 1000,
    description: 'Traditional, highly dependable copper landline phone with continuous battery-backed reliability even during power cuts.',
    features: [
      'Reliable Copper Wire Connection',
      'Operates During Power Outages',
      'Keep Existing Number',
      'Affordable Standard Call Rates',
    ],
    image: 'https://images.unsplash.com/photo-1520923642038-b4259acecbd7?auto=format&fit=crop&w=600&q=80',
    popular: false,
    status: 'active',
    availableQuantity: 999,
  },

  // ── 📺 PEO TV Packages ──
  {
    id: 'prod-peo-basic',
    productId: 'prod-peo-basic',
    productCode: 'SLT-PEO-BASIC',
    name: 'PEO TV Basic',
    category: 'PEO TV',
    serviceType: 'PEO TV',
    speed: 'HD TV',
    monthlyPrice: 1490,
    installationFee: 500,
    description: 'Essential digital television entertainment with live Sri Lankan and international channels, 7-day catch-up, and interactive TV guide.',
    features: [
      '50+ Live Channels (SD & HD)',
      '7-Day Catch-up TV',
      'Pause & Rewind Live TV',
      'Electronic Programme Guide',
      'Free Standard Setup',
    ],
    image: 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=600&q=80',
    popular: false,
    status: 'active',
    availableQuantity: 999,
  },
  {
    id: 'prod-peo-silver',
    productId: 'prod-peo-silver',
    productCode: 'SLT-PEO-SILVER',
    name: 'PEO TV Silver Plus',
    category: 'PEO TV',
    serviceType: 'PEO TV',
    speed: 'HD TV',
    monthlyPrice: 1890,
    installationFee: 500,
    description: 'Rich family entertainment with news, kids, movies, documentaries, and music channels with crystal-clear digital sound.',
    features: [
      '85+ Live HD Channels',
      '7-Day Catch-up TV',
      'Family & Kids Entertainment Pack',
      'On-Demand Movies & Series',
      'Parental Lock & Program Reminders',
    ],
    image: 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=600&q=80',
    popular: true,
    status: 'active',
    availableQuantity: 999,
  },
  {
    id: 'prod-peo-gold',
    productId: 'prod-peo-gold',
    productCode: 'SLT-PEO-GOLD',
    name: 'PEO TV Gold',
    category: 'PEO TV',
    serviceType: 'PEO TV',
    speed: 'HD TV',
    monthlyPrice: 2690,
    installationFee: 500,
    description: 'The premier television experience with live international sports, blockbuster movies, global news, and full VOD catalogue access.',
    features: [
      '120+ Live HD Channels',
      'Premium Sports (Cricket, Football, Tennis)',
      '30-Day Catch-up TV',
      'Full Video-On-Demand Library',
      'Multi-Screen Mobile TV Access',
    ],
    image: 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=600&q=80',
    popular: true,
    status: 'active',
    availableQuantity: 999,
  },
  {
    id: 'prod-peo-titanium',
    productId: 'prod-peo-titanium',
    productCode: 'SLT-PEO-TITAN',
    name: 'PEO TV Titanium Entertainment',
    category: 'PEO TV',
    serviceType: 'PEO TV',
    speed: 'HD TV',
    monthlyPrice: 3890,
    installationFee: 500,
    description: 'All-inclusive VIP television package featuring every HD and 4K channel, unlimited cloud DVR recording, and complimentary pay-per-view events.',
    features: [
      '140+ All-Inclusive Channels',
      'All Premium Sports & 4K Channels',
      'Unlimited Cloud DVR Recording',
      '30-Day Catch-up TV & VOD',
      'VIP Priority Concierge Support',
    ],
    image: 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=600&q=80',
    popular: false,
    status: 'active',
    availableQuantity: 999,
  },
];

export const seedProducts = async () => {
  try {
    await connectDB();
    console.log('Connected to PostgreSQL for product seeding.');

    let seededCount = 0;
    for (const prod of demoProducts) {
      const res = await query(
        `INSERT INTO products (
          id, product_id, product_code, name, category, service_type, speed,
          monthly_price, installation_fee, description, features, image,
          available_quantity, status, popular, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE
        SET product_code = EXCLUDED.product_code,
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            service_type = EXCLUDED.service_type,
            speed = EXCLUDED.speed,
            monthly_price = EXCLUDED.monthly_price,
            installation_fee = EXCLUDED.installation_fee,
            description = EXCLUDED.description,
            features = EXCLUDED.features,
            image = EXCLUDED.image,
            available_quantity = EXCLUDED.available_quantity,
            status = EXCLUDED.status,
            popular = EXCLUDED.popular,
            updated_at = NOW()
        RETURNING id, name;`,
        [
          prod.id,
          prod.productId || prod.id,
          prod.productCode,
          prod.name,
          prod.category,
          prod.serviceType || 'Broadband',
          prod.speed || '',
          prod.monthlyPrice,
          prod.installationFee,
          prod.description,
          JSON.stringify(prod.features),
          prod.image,
          prod.availableQuantity ?? 999,
          prod.status || 'active',
          Boolean(prod.popular),
        ]
      );
      if (res.rows.length > 0) {
        seededCount++;
      }
    }

    console.log(`Successfully seeded ${seededCount} demo products into PostgreSQL 'products' table!`);
    return seededCount;
  } catch (error) {
    console.error('Error seeding products:', error.message);
    throw error;
  }
};

// Auto-run if executed directly
if (process.argv[1] && process.argv[1].endsWith('seedProducts.js')) {
  seedProducts()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
