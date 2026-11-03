import { query, withTransaction, toCamelCase } from '../config/db.js';

export class CartInstance {
  constructor(data = {}) {
    Object.assign(this, toCamelCase(data));
    this.userId = this.userId || data.user_id || data.userId;
    this.items = Array.isArray(this.items) ? this.items : [];
    this.totalAmount = Number(this.totalAmount || 0);
  }

  calculateTotal() {
    this.totalAmount = this.items.reduce((total, item) => {
      const q = Number(item.quantity || 1);
      const p = Number(item.price || 0);
      item.subtotal = q * p;
      return total + item.subtotal;
    }, 0);
    return this.totalAmount;
  }

  addItem(product, quantity = 1) {
    const rawProdId = String(product.productId || product.id || product._id || '');
    const prodId = rawProdId.slice(0, 50);
    const price = Number(product.monthlyPrice || product.price || 0);
    const name = product.name || product.productName || 'Unknown Product';

    const existingIndex = this.items.findIndex(
      (item) => String(item.productId) === prodId
    );

    if (existingIndex !== -1) {
      this.items[existingIndex].quantity = Number(this.items[existingIndex].quantity || 0) + quantity;
      this.items[existingIndex].subtotal = this.items[existingIndex].quantity * price;
    } else {
      this.items.push({
        productId: prodId,
        productName: name,
        quantity,
        price,
        subtotal: quantity * price,
      });
    }

    this.calculateTotal();
    return this.save();
  }

  updateItemQuantity(productId, quantity) {
    const target = String(productId);
    const index = this.items.findIndex(
      (item) => String(item.productId) === target || String(item.id) === target
    );

    if (index === -1) {
      throw new Error('Item not found in cart');
    }

    this.items[index].quantity = quantity;
    this.items[index].subtotal = quantity * Number(this.items[index].price || 0);
    this.calculateTotal();
    return this.save();
  }

  removeItem(productId) {
    const target = String(productId);
    const index = this.items.findIndex(
      (item) => String(item.productId) === target || String(item.id) === target
    );

    if (index !== -1) {
      this.items.splice(index, 1);
      this.calculateTotal();
    }
    return this.save();
  }

  clearCart() {
    this.items = [];
    this.totalAmount = 0;
    return this.save();
  }

  async save() {
    this.calculateTotal();

    return await withTransaction(async (client) => {
      // 1. Upsert cart row
      let cartId = this.id || this._id;
      if (!cartId) {
        const cartRes = await client.query(
          `INSERT INTO carts (user_id, total_amount, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE
           SET total_amount = EXCLUDED.total_amount, updated_at = NOW()
           RETURNING *`,
          [this.userId, this.totalAmount]
        );
        cartId = cartRes.rows[0].id;
        this.id = cartId;
        this._id = cartId;
      } else {
        await client.query(
          `UPDATE carts SET total_amount = $1, updated_at = NOW() WHERE id = $2`,
          [this.totalAmount, cartId]
        );
      }

      // 2. Replace cart_items
      await client.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);

      for (const item of this.items) {
        await client.query(
          `INSERT INTO cart_items (cart_id, product_id, product_name, quantity, price, subtotal, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [
            cartId,
            item.productId,
            item.productName,
            item.quantity,
            item.price,
            item.subtotal,
          ]
        );
      }

      return this;
    });
  }
}

const Cart = {
  findOne(filter = {}) {
    const userId = filter.userId || filter.user_id;
    const builder = {
      lean() {
        return this;
      },
      select() {
        return this;
      },
      sort() {
        return this;
      },
      populate() {
        return this;
      },
      async then(resolve, reject) {
        try {
          if (!userId) return resolve(null);

          const res = await query(
            `SELECT c.*, 
                    COALESCE(
                      json_agg(
                        json_build_object(
                          'id', ci.id,
                          '_id', ci.id,
                          'productId', ci.product_id,
                          'productName', ci.product_name,
                          'quantity', ci.quantity,
                          'price', ci.price,
                          'subtotal', ci.subtotal
                        )
                      ) FILTER (WHERE ci.id IS NOT NULL), '[]'::json
                    ) AS items
             FROM carts c
             LEFT JOIN cart_items ci ON ci.cart_id = c.id
             WHERE c.user_id = $1
             GROUP BY c.id`,
            [userId]
          );

          if (res.rows.length === 0) return resolve(null);
          return resolve(new CartInstance(res.rows[0]));
        } catch (err) {
          reject(err);
        }
      },
      catch(reject) {
        return this.then(null, reject);
      },
    };
    return builder;
  },

  async create(data) {
    const cart = new CartInstance(data);
    await cart.save();
    return cart;
  },

  async findOneAndDelete(filter = {}) {
    const userId = filter.userId;
    if (!userId) return null;
    const existing = await Cart.findOne({ userId });
    if (!existing) return null;
    await query(`DELETE FROM carts WHERE user_id = $1`, [userId]);
    return existing;
  },
};

export default Cart;
