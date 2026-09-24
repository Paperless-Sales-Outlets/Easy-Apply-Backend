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
    const rawItems = json.items || json.data || (Array.isArray(json) ? json : []);

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      console.warn(`\x1b[33m[Product Hub API] Connected (${elapsed}ms) but 0 templates found.\x1b[0m`);
      return null;
    }

    // Helper: Normalize single product node
    const normalizeProductNode = (t, parentCategory) => {
      const fv = t.fieldValues || {};
      const dataObj = t.data || {};
      const attr = t.attributes || {};

      const name = t.productName || t.name || dataObj.productName || 'SLT Package';
      const rawPrice = t.monthlyPrice || t.price || dataObj.monthlyPrice || dataObj.price || fv['Monthly Rental'] || fv['Package Monthly Rental'] || attr['Monthly Rental'] || attr.price;
      let price = Number(rawPrice) || 0;

      // Category detection with parent hierarchy awareness
      const contextStr = `${parentCategory || ''} ${t.category || ''} ${dataObj.category || ''} ${name}`.toLowerCase();
      let category = 'Broadband';
      if (contextStr.includes('peo') || contextStr.includes('tv')) {
        category = 'PEO TV';
      } else if (contextStr.includes('voice') || contextStr.includes('megaline') || contextStr.includes('phone')) {
        category = 'Voice';
      } else if (contextStr.includes('lte') || contextStr.includes('4g')) {
        category = 'LTE Broadband';
      } else if (contextStr.includes('fibre') || contextStr.includes('fiber') || contextStr.includes('broadband')) {
        category = 'Fibre Broadband';
      } else if (parentCategory) {
        category = parentCategory;
      }

      // Fallback tariff pricing for PEO TV if price was 0 or unassigned
      if (price === 0 && category === 'PEO TV') {
        const lowerName = name.toLowerCase();
        if (lowerName.includes('silver plus')) price = 1375;
        else if (lowerName.includes('silver')) price = 1125;
        else if (lowerName.includes('family')) price = 1625;
        else if (lowerName.includes('entertainment')) price = 1875;
        else if (lowerName.includes('gold')) price = 2100;
        else if (lowerName.includes('titanium')) price = 3890;
        else if (lowerName.includes('starter') || lowerName.includes('basic')) price = 1490;
      }

      const installationFee = Number(dataObj['Installation Charge'] ?? dataObj.installationFee ?? fv['Installation Fee'] ?? attr['Installation Fee'] ?? (price > 5000 ? 0 : 2500));

      // Speed detection
      const speedStr = dataObj['Download Speed'] || t.speed;
      const speedMatch = speedStr ? speedStr : name.match(/(\d+)\s*(?:mbps|gbps)/i)?.[0];
      const speed = speedMatch ? (speedMatch.includes('Mbps') || speedMatch.includes('Gbps') ? speedMatch : `${speedMatch} Mbps`) : (category === 'PEO TV' ? 'HD TV' : category === 'Voice' ? 'Voice' : null);

      // Default high quality SLT category visuals
      let defaultImg = 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=800&auto=format&fit=crop&q=80';
      if (category === 'PEO TV') defaultImg = 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?w=800&auto=format&fit=crop&q=80';
      else if (category === 'Voice') defaultImg = 'https://images.unsplash.com/photo-1534536281715-e28d76689b4d?w=800&auto=format&fit=crop&q=80';

      const img = fv['Image']?.url || fv['Image 2']?.url || t.image || dataObj.image || defaultImg;

      // Description & Features
      const description = t.description || dataObj.description || `${name} by SLTMobitel. High-speed connectivity & digital entertainment.`;

      const features = [];
      if (t.features && typeof t.features === 'object' && !Array.isArray(t.features)) {
        if (t.features['No of Channels']) {
          features.push(`${t.features['No of Channels']}+ Live TV Channels`);
        }
      }
      if (speed && speed !== 'Voice' && speed !== 'HD TV') features.push(`Download Speed: ${speed}`);
      if (dataObj['Upload Speed']) features.push(`Upload Speed: ${dataObj['Upload Speed']}`);
      if (dataObj['Data Allowance']) features.push(`Data Allowance: ${dataObj['Data Allowance']}`);
      if (dataObj['Router Model']) features.push(`Router: ${dataObj['Router Model']}`);
      if (category === 'PEO TV') {
        features.push('Live HD Channels', '7-Day Catch-up TV', 'Rewind & Pause Live TV');
      } else if (category === 'Voice') {
        features.push('Unlimited Local SLT Calls', 'Crystal Clear Voice Quality', 'Free Caller ID');
      }
      if (t.description && t.description.trim()) {
        features.push(t.description.trim());
      }
      if (features.length === 0) {
        features.push('High Reliability SLT Network', 'Unlimited Entertainment & Connectivity', '24/7 SLTMobitel Support');
      }

      const id = t._id || t.id || t.templateID || `slt-${Math.random().toString(36).substring(2, 9)}`;

      return {
        _id: id,
        id: id,
        productId: id,
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
        popular: price > 3500 || name.toLowerCase().includes('gold') || name.toLowerCase().includes('family'),
        status: t.lifecycleStatus?.toLowerCase() === 'retired' ? 'inactive' : 'active',
        image: img,
        features: [...new Set(features)].slice(0, 5),
        tmfOffering: t['@type'] === 'ProductOffering' ? t : undefined,
      };
    };

    // Helper: Recursively flatten arbitrary tree hierarchy
    const flattenHierarchy = (nodes, parentCategory = null) => {
      if (!Array.isArray(nodes) || nodes.length === 0) return [];
      const results = [];

      for (const item of nodes) {
        const t = item.template || item;
        const nodeName = t.productName || t.name || t.data?.productName || 'SLT Package';
        const currentCategory = parentCategory || nodeName;
        const hasChildren = Array.isArray(item.children) && item.children.length > 0;
        const rawPrice = t.monthlyPrice || t.price || t.data?.monthlyPrice || t.data?.price || t.fieldValues?.['Monthly Rental'];
        const hasValidPrice = rawPrice !== null && rawPrice !== undefined && rawPrice !== '' && Number(rawPrice) > 0;

        if (hasChildren) {
          // Recurse into children passing current node as category
          const childProducts = flattenHierarchy(item.children, currentCategory);
          results.push(...childProducts);

          // If the parent node itself is also a purchasable standalone product, include it
          if (hasValidPrice) {
            results.push(normalizeProductNode(t, currentCategory));
          }
        } else {
          // Leaf product node
          results.push(normalizeProductNode(t, currentCategory));
        }
      }

      return results;
    };

    const flattenedProducts = flattenHierarchy(rawItems);

    console.log(`\x1b[32m[Product Hub API] Connected Successfully!\x1b[0m Parsed \x1b[1m${flattenedProducts.length} live products\x1b[0m from hierarchy in \x1b[33m${elapsed}ms\x1b[0m (from ${rawItems.length} root categories)`);

    return flattenedProducts;
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

  // 1. Fetch live templates strictly from Product Hub API
  const liveHubProducts = await fetchLiveProductHubTemplates();
  let candidateProducts = [];

  if (liveHubProducts && liveHubProducts.length > 0) {
    const validLive = liveHubProducts.filter(
      (p) => !p.name?.toLowerCase().includes('test') && p.monthlyPrice > 0
    );
    candidateProducts.push(...validLive);
  }

  if (candidateProducts.length > 0) {
    let filtered = candidateProducts;

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
      source: liveHubProducts && liveHubProducts.length > 0 ? 'LIVE_PRODUCT_HUB' : 'LOCAL_DATABASE',
      hubUrl,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: filtered.length,
      },
    };
  }
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

// In-memory cache for single product specifications
const productDetailsCache = new Map();

/**
 * Fetch deep single product specifications, fixed fields, features, and tables from Product Info Hub API.
 * Endpoint: https://dpdlab1.slt.lk:703/public-api/v1/integration/products/{productId}
 */
export const fetchProductDetailsFromHub = async (productId) => {
  if (!productId) return null;

  // Check cache (TTL 10 mins)
  const cached = productDetailsCache.get(productId);
  if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
    return cached.data;
  }

  dotenv.config({ override: true });
  const baseUrl = process.env.PRODUCT_HUB_DETAILS_URL || 'https://dpdlab1.slt.lk:703/public-api/v1/integration/products';
  const detailUrl = `${baseUrl}/${productId}`;
  console.log(`\x1b[36m[Product Hub Detail API]\x1b[0m Fetching specs for product \x1b[33m${productId}\x1b[0m from \x1b[35m${detailUrl}\x1b[0m ...`);

  try {
    const res = await fetch(detailUrl, {
      headers: {
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const json = await res.json();
      console.log(`\x1b[32m[Product Hub Detail API] Successfully retrieved specifications for ${json.product?.productName || productId} (${json.tables?.length || 0} tables)\x1b[0m`);
      const payload = {
        success: true,
        source: 'LIVE_PRODUCT_HUB',
        product: json.product,
        tables: json.tables || [],
      };
      productDetailsCache.set(productId, { timestamp: Date.now(), data: payload });
      return payload;
    } else {
      console.warn(`\x1b[33m[Product Hub Detail API] Product specs not found or in design (Status: ${res.status})\x1b[0m`);
      return {
        success: false,
        source: 'NOTICE',
        message: 'Network Notice: Detailed specifications currently in design or unavailable from Product Info Hub.',
        data: null,
      };
    }
  } catch (err) {
    console.warn(`\x1b[31m[Product Hub Detail API] Network error: ${err.message}\x1b[0m`);
    return {
      success: false,
      source: 'NETWORK_ERROR',
      message: `Network Notice: Unable to connect to Product Info Hub (${err.message}).`,
      data: null,
    };
  }
};

/**
 * Get product details by ID (Tries Hub Detail API first, falls back with clean notice)
 */
export const getProductDetails = async (id) => {
  // 1. Live Hub Query
  const hubResult = await fetchProductDetailsFromHub(id);
  if (hubResult && hubResult.success) {
    return hubResult;
  }

  return {
    success: false,
    source: hubResult?.source || 'NOTICE',
    message: hubResult?.message || 'Network Notice: Detailed specifications currently in design or unavailable from Product Info Hub.',
    data: null,
  };
};

/**
 * Fetches Left Sidebar Product Tree (Hierarchy) from Product Hub (/public-api/v1/products/hierarchy)
 */
export const fetchProductHierarchy = async () => {
  dotenv.config({ override: true });
  const hierarchyUrl = process.env.PRODUCT_HUB_HIERARCHY_URL || 'https://dpdlab1.slt.lk:703/public-api/v1/products/hierarchy';

  const token = await getProductHubToken();
  try {
    console.log(`\x1b[36m[Product Hub Hierarchy]\x1b[0m Fetching hierarchy from: \x1b[33m${hierarchyUrl}\x1b[0m`);
    const res = await fetch(hierarchyUrl, {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.warn(`\x1b[31m[Product Hub Hierarchy] Failed with status ${res.status}\x1b[0m`);
      return [];
    }

    const raw = await res.json();
    const list = Array.isArray(raw) ? raw : raw.items || raw.data || [];

    // Filter out dummy/test nodes
    const cleanNodes = (nodes) => {
      if (!Array.isArray(nodes)) return [];
      return nodes
        .filter((n) => {
          const name = (n.name || n.productName || '').toLowerCase();
          return !name.includes('test');
        })
        .map((n) => ({
          id: n.id,
          name: n.name || n.productName || 'Category',
          children: cleanNodes(n.children),
        }));
    };

    const cleaned = cleanNodes(list);
    return cleaned;
  } catch (err) {
    console.warn('[Product Hub Hierarchy] Error:', err.message);
    return [];
  }
};

/**
 * Fetches Product Cart metadata by ID from Product Hub (/public-api/v1/products/{id})
 */
export const fetchProductCartItem = async (id) => {
  dotenv.config({ override: true });
  const baseUrl = process.env.PRODUCT_HUB_CART_URL || 'https://dpdlab1.slt.lk:703/public-api/v1/products';
  const cartUrl = `${baseUrl}/${id}`;

  const token = await getProductHubToken();
  try {
    console.log(`\x1b[36m[Product Hub Cart Item]\x1b[0m Fetching cart item from: \x1b[33m${cartUrl}\x1b[0m`);
    const res = await fetch(cartUrl, {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.warn(`\x1b[31m[Product Hub Cart Item] Failed with status ${res.status}\x1b[0m`);
      return null;
    }

    const data = await res.json();
    return {
      id: data.id || id,
      productId: data.id || id,
      productName: data.productName || data.name || 'SLT Package',
      name: data.productName || data.name || 'SLT Package',
      price: Number(data.price || data.monthlyPrice || 0),
      monthlyPrice: Number(data.price || data.monthlyPrice || 0),
      description: data.description || '',
      source: 'LIVE_PRODUCT_HUB',
    };
  } catch (err) {
    console.warn('[Product Hub Cart Item] Error:', err.message);
    return null;
  }
};

export default {
  getAllProducts,
  getProductsByCategory,
  searchProducts,
  getProductById,
  getProductByCode,
  getProductDetails,
  fetchProductDetailsFromHub,
  fetchProductHierarchy,
  fetchProductCartItem,
  checkProductAvailability,
  createProduct,
  updateProduct,
  deleteProduct,
};


