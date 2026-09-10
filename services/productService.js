import Product from '../models/Product.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

/**
 * Product Service Layer
 * Handles all product-related business logic
 */

// In-memory token cache for Product Hub
let cachedProductHubToken = null;
let tokenExpiresAt = 0;

/**
 * Automatically retrieves or refreshes the Product Hub JWT token using service credentials.
 */
export const getProductHubToken = async (forceRefresh = false) => {
  dotenv.config({ override: true });

  const authUrl = process.env.PRODUCT_HUB_AUTH_URL || 'https://dpdlab1.slt.lk:703/api/users/login';
  const email = process.env.PRODUCT_HUB_EMAIL || 'user@slt.com';
  const password = process.env.PRODUCT_HUB_PASSWORD || 'User@12345';
  const staticToken = process.env.PRODUCT_HUB_TOKEN || process.env.REACT_APP_PRODUCT_HUB_TOKEN;

  const now = Date.now();
  if (!forceRefresh && cachedProductHubToken && tokenExpiresAt > now + 60 * 1000) {
    return cachedProductHubToken;
  }

  try {
    console.log(`\x1b[36m[Product Hub Auth]\x1b[0m Authenticating with \x1b[33m${authUrl}\x1b[0m as \x1b[35m${email}\x1b[0m ...`);
    const res = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.warn(`\x1b[31m[Product Hub Auth] Login failed (Status: ${res.status} ${res.statusText})\x1b[0m`);
      return staticToken || null;
    }

    const data = await res.json();
    const token = data.token || data.accessToken || data.jwt;

    if (token) {
      cachedProductHubToken = token;
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
        tokenExpiresAt = payload.exp ? payload.exp * 1000 : now + 24 * 60 * 60 * 1000;
      } catch (e) {
        tokenExpiresAt = now + 24 * 60 * 60 * 1000;
      }
      console.log(`\x1b[32m[Product Hub Auth] Token retrieved & cached successfully!\x1b[0m (Valid until ${new Date(tokenExpiresAt).toLocaleTimeString()})`);
      return token;
    }

    return staticToken || null;
  } catch (err) {
    console.warn(`\x1b[31m[Product Hub Auth] Error acquiring token:\x1b[0m`, err.message);
    return staticToken || null;
  }
};

/**
 * Fetches and normalizes live templates from Product Info Hub API
 */
export const fetchLiveProductHubTemplates = async () => {
  dotenv.config({ override: true });
  const hubUrl = process.env.PRODUCT_HUB_URL || process.env.REACT_APP_PRODUCT_HUB_URL || 'https://dpdlab1.slt.lk:703/api/templates';

  if (!hubUrl) return null;

  let token = await getProductHubToken();
  const startTime = Date.now();
  console.log(`\x1b[36m[Product Hub API]\x1b[0m Connecting to: \x1b[33m${hubUrl}\x1b[0m ...`);

  try {
    let res = await fetch(hubUrl, {
      headers: {
        'Authorization': token ? `Bearer ${token}` : '',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(6000),
    });

    // If unauthorized / token expired, refresh token and retry once
    if (res.status === 401) {
      console.warn(`\x1b[33m[Product Hub API] Received 401 Unauthorized. Refreshing token & retrying...\x1b[0m`);
      token = await getProductHubToken(true);
      if (token) {
        res = await fetch(hubUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(6000),
        });
      }
    }

    const elapsed = Date.now() - startTime;

    if (!res.ok) {
      console.warn(`\x1b[31m[Product Hub API] Connection Failed (Status: ${res.status} ${res.statusText})\x1b[0m`);
      return null;
    }

    const json = await res.json();
    const rawItems = json.data || (Array.isArray(json) ? json : []);

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      console.warn(`\x1b[33m[Product Hub API] Connected (${elapsed}ms) but 0 templates found.\x1b[0m`);
      return null;
    }

    console.log(`\x1b[32m[Product Hub API] Connected Successfully!\x1b[0m Fetched \x1b[1m${rawItems.length} live templates\x1b[0m in \x1b[33m${elapsed}ms\x1b[0m from \x1b[34m${hubUrl}\x1b[0m`);

    return rawItems.map((item) => {
      const t = item.template || item;
      const fv = t.fieldValues || {};
      const dataObj = t.data || {};

      // Name & Title
      const name = t.productName || t.name || dataObj.productName || 'SLT Package';

      // Pricing
      const price = Number(t.price ?? dataObj.price ?? fv['Monthly Rental'] ?? 0);
      const installationFee = Number(dataObj['Installation Charge'] ?? dataObj.installationFee ?? fv['Installation Fee'] ?? 2500);

      // Category detection
      let category = t.category || dataObj.category || 'Broadband';
      const lowerName = name.toLowerCase();
      const tech = (dataObj['Connection Technology'] || '').toLowerCase();
      if (lowerName.includes('peo') || lowerName.includes('tv')) category = 'PEO TV';
      else if (lowerName.includes('voice') || lowerName.includes('megaline') || lowerName.includes('phone')) category = 'Voice';
      else if (lowerName.includes('lte') || lowerName.includes('4g') || tech.includes('lte')) category = 'LTE Broadband';
      else if (lowerName.includes('fibre') || lowerName.includes('fiber') || tech.includes('ftth')) category = 'Broadband';

      // Speed detection
      const speedStr = dataObj['Download Speed'] || t.speed;
      const speedMatch = speedStr ? speedStr : name.match(/(\d+)\s*(?:mbps|gbps)/i)?.[0];
      const speed = speedMatch ? (speedMatch.includes('Mbps') || speedMatch.includes('Gbps') ? speedMatch : `${speedMatch} Mbps`) : null;

      // Image URL
      const img = fv['Image']?.url || fv['Image 2']?.url || t.image || dataObj.image || '';

      // Description & Features
      const description = t.description || dataObj.description || `${name} by SLTMobitel. High-speed connectivity & digital entertainment.`;

      const features = [];
      if (speed) features.push(`Download Speed: ${speed}`);
      if (dataObj['Upload Speed']) features.push(`Upload Speed: ${dataObj['Upload Speed']}`);
      if (dataObj['Data Allowance']) features.push(`Data Allowance: ${dataObj['Data Allowance']}`);
      if (dataObj['Router Model']) features.push(`Router: ${dataObj['Router Model']}`);
      if (dataObj['Voice Service Included'] === 'Yes') features.push('Voice Landline Included');
      if (features.length === 0) {
        features.push('High Reliability SLT Network', 'Unlimited Entertainment & Connectivity', '24/7 SLTMobitel Support');
      }

      return {
        _id: t._id || t.id || t.templateID,
        id: t._id || t.id || t.templateID,
        productId: t._id || t.id || t.templateID,
        productCode: `SLT-${name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`,
        name,
        productName: name,
        description,
        category,
        speed,
        monthlyPrice: price,
        price,
        installationFee,
        availableQuantity: 999,
        popular: price > 5000,
        status: t.lifecycleStatus?.toLowerCase() === 'retired' ? 'inactive' : 'active',
        image: img,
        features,
        tmfOffering: t['@type'] === 'ProductOffering' ? t : undefined,
      };
    });
  } catch (err) {
    console.warn(`\x1b[31m[Product Hub API] Live fetch error: ${err.message}\x1b[0m`);
    return null;
  }
};

/**
 * Get all products with pagination, sorting, and filtering
 */
export const getAllProducts = async (options = {}) => {
  const {
    page = 1,
    limit = 50,
    category,
    status = 'active',
    sortBy = 'createdAt',
    sortOrder = 'desc',
    search,
    speed,
    maxPrice,
  } = options;

  const hubUrl = process.env.PRODUCT_HUB_URL || process.env.REACT_APP_PRODUCT_HUB_URL || 'https://dpdlab1.slt.lk:703/api/templates';

  // 1. Try fetching live templates from Product Hub
  const liveHubProducts = await fetchLiveProductHubTemplates();
  if (liveHubProducts && liveHubProducts.length > 0) {
    let filtered = liveHubProducts;

    if (status && status !== 'all') {
      filtered = filtered.filter((p) => p.status === status);
    }
    if (category && category !== 'All Products') {
      const cleanCat = category.replace('-', ' ').toLowerCase();
      filtered = filtered.filter((p) => p.category?.toLowerCase().includes(cleanCat));
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name?.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          p.category?.toLowerCase().includes(q) ||
          p.speed?.toLowerCase().includes(q)
      );
    }
    if (maxPrice) {
      filtered = filtered.filter((p) => p.monthlyPrice <= Number(maxPrice));
    }

    const startIndex = (page - 1) * limit;
    const paginated = filtered.slice(startIndex, startIndex + Number(limit));

    return {
      products: paginated,
      source: 'LIVE_PRODUCT_HUB',
      hubUrl,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: filtered.length,
      },
    };
  }

  // 2. Fallback to local MongoDB database
  console.log('\x1b[33m[Product Hub API] Using Local MongoDB database fallback\x1b[0m');
  const query = {};

  if (status && status !== 'all') {
    query.status = status;
  }

  if (category && category !== 'All Products') {
    query.category = { $regex: new RegExp(`^${category.replace('-', ' ')}`, 'i') };
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } },
      { speed: { $regex: search, $options: 'i' } },
    ];
  }

  if (maxPrice) {
    query.monthlyPrice = { $lte: Number(maxPrice) };
  }

  const skip = (page - 1) * limit;
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  const [products, total] = await Promise.all([
    Product.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit, 10))
      .lean(),
    Product.countDocuments(query),
  ]);

  return {
    products,
    pagination: {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      total,
    },
  };
};

/**
 * Get products by category
 */
export const getProductsByCategory = async (category) => {
  const query = { status: 'active' };
  if (category && category !== 'All Products') {
    const formattedCategory = category.replace('-', ' ');
    query.category = { $regex: new RegExp(`^${formattedCategory}`, 'i') };
  }
  const products = await Product.find(query).lean();
  return products;
};

/**
 * Search products supporting category, speed, price, and keyword
 */
export const searchProducts = async (params = {}) => {
  const { category, speed, price, keyword, maxPrice } = params;
  const query = { status: 'active' };

  if (category && category !== 'All Products') {
    query.category = { $regex: new RegExp(`^${category.replace('-', ' ')}`, 'i') };
  }

  if (keyword) {
    query.$or = [
      { name: { $regex: keyword, $options: 'i' } },
      { description: { $regex: keyword, $options: 'i' } },
      { speed: { $regex: keyword, $options: 'i' } },
    ];
  }

  if (speed) {
    query.speed = { $regex: speed, $options: 'i' };
  }

  const targetPrice = price || maxPrice;
  if (targetPrice) {
    query.monthlyPrice = { $lte: Number(targetPrice) };
  }

  const products = await Product.find(query).lean();
  return products;
};

/**
 * Get a single product by ID
 */
export const getProductById = async (id) => {
  let product = null;
  if (mongoose.Types.ObjectId.isValid(id)) {
    product = await Product.findById(id).lean();
  }
  if (!product) {
    product = await Product.findOne({ productId: id }).lean();
  }
  if (!product) {
    throw new Error('Product not found');
  }
  return product;
};

/**
 * Get a single product by product code
 */
export const getProductByCode = async (productCode) => {
  const product = await Product.findOne({ productCode }).lean();

  if (!product) {
    throw new Error('Product not found');
  }

  return product;
};

/**
 * Check if product exists and has sufficient stock
 */
export const checkProductAvailability = async (productId, quantity) => {
  let product = null;
  if (mongoose.Types.ObjectId.isValid(productId)) {
    product = await Product.findById(productId);
  }
  if (!product) {
    product = await Product.findOne({ productId });
  }

  if (!product) {
    throw new Error('Product not found');
  }

  if (product.status !== 'active') {
    throw new Error('Product is not available');
  }

  return product;
};

/**
 * Create a new product (Admin)
 */
export const createProduct = async (productData) => {
  const product = await Product.create(productData);
  return product;
};

/**
 * Update a product (Admin)
 */
export const updateProduct = async (productId, updateData) => {
  const product = await Product.findByIdAndUpdate(
    productId,
    updateData,
    { new: true, runValidators: true }
  );

  if (!product) {
    throw new Error('Product not found');
  }

  return product;
};

/**
 * Delete a product (Admin)
 */
export const deleteProduct = async (productId) => {
  const product = await Product.findByIdAndDelete(productId);

  if (!product) {
    throw new Error('Product not found');
  }

  return product;
};

export default {
  getAllProducts,
  getProductsByCategory,
  searchProducts,
  getProductById,
  getProductByCode,
  checkProductAvailability,
  createProduct,
  updateProduct,
  deleteProduct,
};

