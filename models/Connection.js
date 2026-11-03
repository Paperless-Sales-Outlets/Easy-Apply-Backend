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

export class ConnectionInstance {
  constructor(data = {}) {
    Object.assign(this, toCamelCase(data));
    this.location = this.location || {};
  }

  async save() {
    if (!this.id && !this._id) {
      const created = await Connection.create(this);
      Object.assign(this, created);
      return this;
    }

    const res = await query(
      `UPDATE connections
       SET account_no = $1, full_name = $2, nic = $3, contact_no = $4,
           address_line1 = $5, address_line2 = $6, location = $7,
           customer_type = $8, email = $9, updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        this.accountNo || null,
        this.fullName,
        this.nic,
        this.contactNo,
        this.addressLine1,
        this.addressLine2 || '',
        JSON.stringify(this.location || {}),
        this.customerType || 'home',
        this.email || '',
        this.id || this._id,
      ]
    );

    if (res.rows.length > 0) {
      Object.assign(this, toCamelCase(res.rows[0]));
    }
    return this;
  }
}

class Connection extends ConnectionInstance {
  constructor(data = {}) {
    super(data);
  }
}

Connection.findById = function (id) {
  return createFindByIdQueryBuilder({
    tableName: 'connections',
    id,
    ModelClass: Connection,
  });
};

Connection.findOne = function (filter = {}) {
  return createFindOneQueryBuilder({
    tableName: 'connections',
    filter,
    ModelClass: Connection,
  });
};

Connection.find = function (filter = {}) {
  return createQueryBuilder({
    tableName: 'connections',
    filter,
    ModelClass: Connection,
  });
};

Connection.create = async function (data) {
  const res = await query(
    `INSERT INTO connections (
      telephone, account_no, full_name, nic, contact_no,
      address_line1, address_line2, location, customer_type, email,
      created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
     ON CONFLICT (telephone) DO UPDATE
     SET full_name = EXCLUDED.full_name, updated_at = NOW()
     RETURNING *`,
    [
      (data.telephone || '').trim(),
      data.accountNo || null,
      data.fullName || '',
      (data.nic || '').trim(),
      (data.contactNo || data.telephone || '').trim(),
      data.addressLine1 || '',
      data.addressLine2 || '',
      JSON.stringify(data.location || {}),
      data.customerType || 'home',
      data.email || '',
    ]
  );
  return new Connection(res.rows[0]);
};

Connection.countDocuments = function (filter = {}) {
  return createQueryBuilder({
    tableName: 'connections',
    filter,
    countQuery: true,
  });
};

Connection.findOneAndUpdate = async function (filter, update = {}, options = {}) {
  return genericFindOneAndUpdate('connections', filter, update, options, Connection);
};

Connection.findByIdAndUpdate = async function (id, update = {}, options = {}) {
  const existing = await Connection.findById(id);
  if (!existing) return null;
  const fields = update.$set || update;
  Object.assign(existing, fields);
  return await existing.save();
};

export default Connection;
