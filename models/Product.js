import { query, toCamelCase } from '../config/db.js';
import {
  buildWhereClause,
  createQueryBuilder,
  createFindOneQueryBuilder,
  genericFindOneAndUpdate,
  formatColumnOrPath,
  toSnakeCase,
} from '../db/modelHelper.js';

export class ProductInstance {
  constructor(data = {}) {
    Object.assign(this, toCamelCase(data));
  }

  get productName() {
    return this.name;
  }

  get price() {
    return this.monthlyPrice;
  }

  get inStock() {
    return (this.availableQuantity ?? 0) > 0 && this.status === 'active';
  }

  get(field) {
    if (field === 'productName') return this.productName;
    if (field === 'price') return this.price;
    return this[field];
  }

  async save() {
    const res = await query(
      `UPDATE products
       SET product_code = $1, name = $2, category = $3, service_type = $4,
           speed = $5, monthly_price = $6, installation_fee = $7, description = $8,
           features = $9, image = $10, available_quantity = $11, status = $12,
           popular = $13, updated_at = NOW()
       WHERE id = $14
       RETURNING *`,
      [
        this.productCode || '',
        this.name,
        this.category,
        this.serviceType || 'Broadband',
        this.speed || '',
        Number(this.monthlyPrice || 0),
        Number(this.installationFee || 0),
        this.description || '',
        JSON.stringify(Array.isArray(this.features) ? this.features : []),
        this.image || '',
        Number(this.availableQuantity ?? 999),
        this.status || 'active',
        Boolean(this.popular),
        this.id || this.productId,
      ]
    );

    if (res.rows.length > 0) {
      Object.assign(this, toCamelCase(res.rows[0]));
    }
    return this;
  }
}

const Product = {
  findById(id) {
    if (!id) {
      const emptyBuilder = {
        select() {
          return this;
        },
        lean() {
          return this;
        },
        populate() {
          return this;
        },
        then(resolve) {
          resolve(null);
        },
        catch() {
          return this;
        },
      };
      return emptyBuilder;
    }
    return createFindOneQueryBuilder({
      tableName: 'products',
      filter: { $or: [{ id: String(id) }, { productId: String(id) }] },
      ModelClass: ProductInstance,
    });
  },

  findOne(filter = {}) {
    return createFindOneQueryBuilder({
      tableName: 'products',
      filter,
      ModelClass: ProductInstance,
    });
  },

  find(filter = {}) {
    return createQueryBuilder({
      tableName: 'products',
      filter,
      ModelClass: ProductInstance,
    });
  },

  async create(data) {
    const id = data.id || data.productId || `prod-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const prodId = data.productId || id;

    const res = await query(
      `INSERT INTO products (
        id, product_id, product_code, name, category, service_type, speed,
        monthly_price, installation_fee, description, features, image,
        available_quantity, status, popular, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name, monthly_price = EXCLUDED.monthly_price, updated_at = NOW()
       RETURNING *`,
      [
        id,
        prodId,
        data.productCode || '',
        data.name,
        data.category,
        data.serviceType || 'Broadband',
        data.speed || '',
        Number(data.monthlyPrice || data.price || 0),
        Number(data.installationFee || 0),
        data.description || '',
        JSON.stringify(Array.isArray(data.features) ? data.features : []),
        data.image || '',
        Number(data.availableQuantity ?? 999),
        data.status || 'active',
        Boolean(data.popular),
      ]
    );

    return new ProductInstance(res.rows[0]);
  },

  async countDocuments(filter = {}) {
    return createQueryBuilder({
      tableName: 'products',
      filter,
      countQuery: true,
    });
  },

  async findByIdAndUpdate(id, update = {}, options = {}) {
    const existing = await Product.findById(id);
    if (!existing) return null;
    const fields = update.$set || update;
    Object.assign(existing, fields);
    return await existing.save();
  },

  async findByIdAndDelete(id) {
    if (!id) return null;
    const existing = await Product.findById(id);
    if (!existing) return null;
    await query(`DELETE FROM products WHERE id = $1 OR product_id = $1`, [String(id)]);
    return existing;
  },
};

export default Product;
