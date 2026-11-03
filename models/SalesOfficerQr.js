import { query, toCamelCase } from '../config/db.js';
import { buildWhereClause, createQueryBuilder } from '../db/modelHelper.js';
import User from './User.js';

export class SalesOfficerQrInstance {
  constructor(data = {}) {
    Object.assign(this, toCamelCase(data));
    this.previousTokens = Array.isArray(this.previousTokens) ? this.previousTokens : [];
    this.metadata = this.metadata || {};
    this.officer = this.officerId || null;
  }

  async save() {
    const res = await query(
      `UPDATE sales_officer_qrs
       SET tracking_token = $1, qr_url = $2, is_active = $3,
           scans_count = $4, last_scanned_at = $5, regenerated_at = $6,
           previous_tokens = $7, metadata = $8, updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [
        this.trackingToken,
        this.qrUrl || '',
        this.isActive !== false,
        Number(this.scansCount || 0),
        this.lastScannedAt || null,
        this.regeneratedAt || null,
        JSON.stringify(this.previousTokens || []),
        JSON.stringify(this.metadata || {}),
        this.id || this._id,
      ]
    );

    if (res.rows.length > 0) {
      Object.assign(this, toCamelCase(res.rows[0]));
    }
    return this;
  }
}

const SalesOfficerQr = {
  async findById(id) {
    if (!id) return null;
    const res = await query(`SELECT * FROM sales_officer_qrs WHERE id = $1`, [id]);
    return res.rows.length ? new SalesOfficerQrInstance(res.rows[0]) : null;
  },

  findOne(filter = {}) {
    // Map officer -> officer_id
    const mappedFilter = { ...filter };
    if (mappedFilter.officer) {
      mappedFilter.officer_id = mappedFilter.officer;
      delete mappedFilter.officer;
    }

    let shouldPopulateOfficer = false;
    const builder = createQueryBuilder({
      tableName: 'sales_officer_qrs',
      filter: mappedFilter,
      ModelClass: SalesOfficerQrInstance,
    }).limit(1);

    builder.populate = function (field) {
      if (field === 'officer') shouldPopulateOfficer = true;
      return builder;
    };

    const originalThen = builder.then.bind(builder);
    builder.then = (resolve, reject) => {
      return originalThen(async (rows) => {
        if (!rows || rows.length === 0) return resolve(null);
        const record = rows[0];
        if (shouldPopulateOfficer && record.officerId) {
          const user = await User.findById(record.officerId);
          if (user) record.officer = user;
        }
        resolve(record);
      }, reject);
    };
    return builder;
  },

  find(filter = {}) {
    const mappedFilter = { ...filter };
    if (mappedFilter.officer) {
      mappedFilter.officer_id = mappedFilter.officer;
      delete mappedFilter.officer;
    }

    return createQueryBuilder({
      tableName: 'sales_officer_qrs',
      filter: mappedFilter,
      ModelClass: SalesOfficerQrInstance,
    });
  },

  async create(data) {
    const officerUuid = data.officerId || data.officer;

    const res = await query(
      `INSERT INTO sales_officer_qrs (
        officer_id, employee_number, tracking_token, qr_url,
        is_active, scans_count, last_scanned_at, regenerated_at,
        previous_tokens, metadata, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       ON CONFLICT (officer_id) DO UPDATE
       SET tracking_token = EXCLUDED.tracking_token,
           qr_url = EXCLUDED.qr_url,
           updated_at = NOW()
       RETURNING *`,
      [
        officerUuid,
        data.employeeNumber.trim(),
        data.trackingToken.trim(),
        data.qrUrl || '',
        data.isActive !== false,
        Number(data.scansCount || 0),
        data.lastScannedAt || null,
        data.regeneratedAt || null,
        JSON.stringify(data.previousTokens || []),
        JSON.stringify(data.metadata || {}),
      ]
    );

    return new SalesOfficerQrInstance(res.rows[0]);
  },

  async countDocuments(filter = {}) {
    return createQueryBuilder({
      tableName: 'sales_officer_qrs',
      filter,
      countQuery: true,
    });
  },

  async findByIdAndUpdate(id, update = {}, options = {}) {
    const existing = await SalesOfficerQr.findById(id);
    if (!existing) return null;
    const fields = update.$set || update;
    Object.assign(existing, fields);
    return await existing.save();
  },

  async findByIdAndDelete(id) {
    if (!id) return null;
    const existing = await SalesOfficerQr.findById(id);
    if (!existing) return null;
    await query(`DELETE FROM sales_officer_qrs WHERE id = $1`, [id]);
    return existing;
  },

  async deleteOne(filter = {}) {
    const { whereText, values } = buildWhereClause(filter);
    await query(`DELETE FROM sales_officer_qrs WHERE id IN (SELECT id FROM sales_officer_qrs ${whereText} LIMIT 1)`, values);
  },
};

export default SalesOfficerQr;
