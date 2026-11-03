import { query, toCamelCase } from '../config/db.js';
import { buildWhereClause } from '../db/modelHelper.js';

export class OtpInstance {
  constructor(data = {}) {
    Object.assign(this, toCamelCase(data));
  }

  async save() {
    const res = await query(
      `UPDATE otps
       SET attempts = $1, code_hash = $2, expires_at = $3
       WHERE id = $4
       RETURNING *`,
      [this.attempts, this.codeHash, this.expiresAt, this.id || this._id]
    );
    if (res.rows.length > 0) {
      Object.assign(this, toCamelCase(res.rows[0]));
    }
    return this;
  }
}

const Otp = {
  async findOne(filter = {}) {
    const { whereText, values } = buildWhereClause(filter);
    const sql = `SELECT * FROM otps ${whereText} ORDER BY created_at DESC LIMIT 1`;
    const res = await query(sql, values);
    return res.rows.length ? new OtpInstance(res.rows[0]) : null;
  },

  async create(data) {
    const res = await query(
      `INSERT INTO otps (identifier, type, code_hash, attempts, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [
        data.identifier,
        data.type || 'mobile',
        data.codeHash || data.otp || '',
        data.attempts || 0,
        data.expiresAt,
      ]
    );
    return new OtpInstance(res.rows[0]);
  },

  async deleteMany(filter = {}) {
    const { whereText, values } = buildWhereClause(filter);
    await query(`DELETE FROM otps ${whereText}`, values);
  },

  async deleteOne(filter = {}) {
    const { whereText, values } = buildWhereClause(filter);
    await query(`DELETE FROM otps WHERE id IN (SELECT id FROM otps ${whereText} LIMIT 1)`, values);
  },
};

export default Otp;
