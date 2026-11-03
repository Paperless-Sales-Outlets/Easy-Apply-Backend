import bcrypt from 'bcryptjs';
import { query, toCamelCase } from '../config/db.js';
import {
  buildWhereClause,
  createQueryBuilder,
  createFindOneQueryBuilder,
  createFindByIdQueryBuilder,
} from '../db/modelHelper.js';

export class UserInstance {
  constructor(data = {}) {
    Object.assign(this, toCamelCase(data));
    if (this.passwordHash && !this.password) {
      this.password = this.passwordHash;
    }
  }

  async matchPassword(enteredPassword) {
    const hash = this.passwordHash || this.password;
    if (!hash) return false;
    return await bcrypt.compare(enteredPassword, hash);
  }

  async save() {
    let hash = this.passwordHash || this.password;
    if (this._passwordModified && this.password) {
      const salt = await bcrypt.genSalt(10);
      hash = await bcrypt.hash(this.password, salt);
      this.passwordHash = hash;
      this._passwordModified = false;
    }

    const res = await query(
      `UPDATE users
       SET name = $1, email = $2, phone = $3, nic = $4, role = $5,
           employee_number = $6, permissions = $7, is_active = $8,
           password_hash = $9, updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        this.name,
        this.email ? this.email.toLowerCase().trim() : null,
        this.phone || null,
        this.nic || this.NIC || null,
        this.role,
        this.employeeNumber || null,
        this.permissions || [],
        this.isActive !== false,
        hash,
        this.id || this._id,
      ]
    );

    if (res.rows.length > 0) {
      Object.assign(this, toCamelCase(res.rows[0]));
    }
    return this;
  }
}

const User = {
  findById(id) {
    return createFindByIdQueryBuilder({
      tableName: 'users',
      id,
      ModelClass: UserInstance,
    });
  },

  findOne(filter = {}) {
    return createFindOneQueryBuilder({
      tableName: 'users',
      filter,
      ModelClass: UserInstance,
    });
  },

  find(filter = {}) {
    return createQueryBuilder({
      tableName: 'users',
      filter,
      ModelClass: UserInstance,
    });
  },

  async create(data) {
    let passwordHash = data.password || data.passwordHash || null;
    if (passwordHash && !passwordHash.startsWith('$2')) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(passwordHash, salt);
    }

    const email = data.email ? data.email.toLowerCase().trim() : null;
    const phone = data.phone ? data.phone.trim() : null;
    const nic = data.NIC || data.nic ? (data.NIC || data.nic).toUpperCase().trim() : null;
    const employeeNumber = data.employeeNumber ? data.employeeNumber.trim() : null;

    const res = await query(
      `INSERT INTO users (name, email, phone, nic, role, employee_number, permissions, is_active, password_hash, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       RETURNING *`,
      [
        data.name ? data.name.trim() : '',
        email,
        phone,
        nic,
        data.role,
        employeeNumber,
        Array.isArray(data.permissions) ? data.permissions : [],
        data.isActive !== false,
        passwordHash,
        data.createdBy || null,
      ]
    );

    return new UserInstance(res.rows[0]);
  },

  async countDocuments(filter = {}) {
    return createQueryBuilder({
      tableName: 'users',
      filter,
      countQuery: true,
    });
  },

  async findByIdAndUpdate(id, update = {}, options = {}) {
    const existing = await User.findById(id);
    if (!existing) return null;

    // Handle $set operator or plain object
    const fields = update.$set || update;
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'password') {
        existing.password = v;
        existing._passwordModified = true;
      } else {
        existing[k] = v;
      }
    }

    return await existing.save();
  },

  async findByIdAndDelete(id) {
    if (!id) return null;
    const existing = await User.findById(id);
    if (!existing) return null;
    await query(`DELETE FROM users WHERE id = $1`, [id]);
    return existing;
  },

  // Support for aggregate (used in roles counting)
  async aggregate(pipeline = []) {
    // Pipeline match role in [roles] -> group by role
    if (pipeline.length >= 2 && pipeline[0].$match && pipeline[1].$group) {
      const roles = pipeline[0].$match?.role?.$in || [];
      const res = await query(
        `SELECT role as "_id", COUNT(*)::int as count 
         FROM users 
         WHERE role = ANY($1) 
         GROUP BY role`,
        [roles]
      );
      return res.rows;
    }
    return [];
  },
};

export default User;
