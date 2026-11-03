import bcrypt from 'bcryptjs';
import { query, toCamelCase } from '../config/db.js';
import {
  buildWhereClause,
  createQueryBuilder,
  createFindOneQueryBuilder,
  createFindByIdQueryBuilder,
  genericFindOneAndUpdate,
  formatColumnOrPath,
  toSnakeCase,
} from '../db/modelHelper.js';

export class CustomerInstance {
  constructor(data = {}) {
    Object.assign(this, toCamelCase(data));
    if (this.nic && !this.NIC) this.NIC = this.nic;
    if (this.NIC && !this.nic) this.nic = this.NIC;
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
    if (!this.id && !this._id) {
      const created = await Customer.create(this);
      Object.assign(this, created);
      return this;
    }

    let hash = this.passwordHash || this.password;
    if (this._passwordModified && this.password) {
      const salt = await bcrypt.genSalt(10);
      hash = await bcrypt.hash(this.password, salt);
      this.passwordHash = hash;
      this._passwordModified = false;
    }

    const res = await query(
      `UPDATE customers
       SET name = $1, email = $2, phone = $3, role = $4, nic = $5,
           title = $6, dob = $7, gender = $8, nationality = $9, contact_number = $10,
           address_line1 = $11, address_line2 = $12, city = $13, district = $14,
           postal_code = $15, preferred_contact = $16, identity_documents = $17,
           kyc_status = $18, kyc_notes = $19, kyc_actioned_at = $20,
           password_hash = $21, updated_at = NOW()
       WHERE id = $22
       RETURNING *`,
      [
        this.name || '',
        this.email ? this.email.toLowerCase().trim() : null,
        (this.phone || '').trim(),
        this.role || 'Customer',
        this.nic || this.NIC || null,
        this.title || 'Mr.',
        this.dob || null,
        this.gender || 'Male',
        this.nationality || 'Sri Lankan',
        this.contactNumber || null,
        this.addressLine1 || null,
        this.addressLine2 || null,
        this.city || null,
        this.district || null,
        this.postalCode || null,
        this.preferredContact || 'SMS',
        JSON.stringify(this.identityDocuments || {}),
        this.kycStatus || 'pending',
        this.kycNotes || null,
        this.kycActionedAt || null,
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

class Customer extends CustomerInstance {
  constructor(data = {}) {
    super(data);
  }
}

Customer.findById = function (id) {
  return createFindByIdQueryBuilder({
    tableName: 'customers',
    id,
    ModelClass: Customer,
  });
};

Customer.findOne = function (filter = {}) {
  return createFindOneQueryBuilder({
    tableName: 'customers',
    filter,
    ModelClass: Customer,
  });
};

Customer.find = function (filter = {}) {
  return createQueryBuilder({
    tableName: 'customers',
    filter,
    ModelClass: Customer,
  });
};

Customer.create = async function (data) {
  let passwordHash = data.password || data.passwordHash || null;
  if (passwordHash && !passwordHash.startsWith('$2')) {
    const salt = await bcrypt.genSalt(10);
    passwordHash = await bcrypt.hash(passwordHash, salt);
  }

  const email = data.email ? data.email.toLowerCase().trim() : null;
  const phone = (data.phone || '').trim();
  const nic = data.NIC || data.nic ? (data.NIC || data.nic).toUpperCase().trim() : null;

  const res = await query(
    `INSERT INTO customers (
      name, email, phone, role, nic, title, dob, gender, nationality,
      contact_number, address_line1, address_line2, city, district,
      postal_code, preferred_contact, identity_documents, kyc_status,
      kyc_notes, kyc_actioned_at, password_hash, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW(), NOW())
     RETURNING *`,
    [
      data.name ? data.name.trim() : '',
      email,
      phone,
      data.role || 'Customer',
      nic,
      data.title || 'Mr.',
      data.dob || null,
      data.gender || 'Male',
      data.nationality || 'Sri Lankan',
      data.contactNumber || null,
      data.addressLine1 || null,
      data.addressLine2 || null,
      data.city || null,
      data.district || null,
      data.postalCode || null,
      data.preferredContact || 'SMS',
      JSON.stringify(data.identityDocuments || {}),
      data.kycStatus || 'pending',
      data.kycNotes || null,
      data.kycActionedAt || null,
      passwordHash,
    ]
  );

  return new Customer(res.rows[0]);
};

Customer.countDocuments = function (filter = {}) {
  return createQueryBuilder({
    tableName: 'customers',
    filter,
    countQuery: true,
  });
};

Customer.distinct = async function (field, filter = {}) {
  const col = field === '_id' ? 'id' : field.includes('.') ? formatColumnOrPath(field) : toSnakeCase(field);
  const { whereText, values } = buildWhereClause(filter);
  const sql = `SELECT DISTINCT ${col} as val FROM customers ${whereText ? `${whereText} AND` : 'WHERE'} ${col} IS NOT NULL`;
  const res = await query(sql, values);
  return res.rows.map((r) => r.val);
};

Customer.findOneAndUpdate = async function (filter, update = {}, options = {}) {
  return genericFindOneAndUpdate('customers', filter, update, options, Customer);
};

Customer.findByIdAndUpdate = async function (id, update = {}, options = {}) {
  const existing = await Customer.findById(id);
  if (!existing) return null;
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
};

Customer.findByIdAndDelete = async function (id) {
  if (!id) return null;
  const existing = await Customer.findById(id);
  if (!existing) return null;
  await query(`DELETE FROM customers WHERE id = $1`, [id]);
  return existing;
};

Customer.deleteMany = async function (filter = {}) {
  const { whereText, values } = buildWhereClause(filter);
  await query(`DELETE FROM customers ${whereText}`, values);
};

export default Customer;
