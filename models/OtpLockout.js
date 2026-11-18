import { query, toCamelCase } from '../config/db.js';
import { buildWhereClause } from '../db/modelHelper.js';

const OtpLockout = {
  async findOne(filter = {}) {
    const { whereText, values } = buildWhereClause(filter);
    const sql = `SELECT * FROM otp_lockouts ${whereText} ORDER BY created_at DESC LIMIT 1`;
    const res = await query(sql, values);
    return res.rows.length ? toCamelCase(res.rows[0]) : null;
  },

  async create(data) {
    const identifier = data.identifier || data.target || data.phone || data.email || '';
    const res = await query(
      `INSERT INTO otp_lockouts (identifier, type, locked_until, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [identifier, data.type || 'mobile', data.lockedUntil]
    );
    return toCamelCase(res.rows[0]);
  },

  async findOneAndUpdate(filter = {}, update = {}, options = {}) {
    const cleanIdentifier = filter.identifier || filter.target || filter.phone || filter.email || update.identifier || update.target || update.phone || update.email;
    const type = filter.type || update.type || 'mobile';
    const lockedUntil = update.lockedUntil || new Date(Date.now() + 15 * 60 * 1000);

    const existing = await OtpLockout.findOne({ identifier: cleanIdentifier });
    if (existing) {
      const res = await query(
        `UPDATE otp_lockouts SET locked_until = $1 WHERE id = $2 RETURNING *`,
        [lockedUntil, existing.id]
      );
      return toCamelCase(res.rows[0]);
    } else if (options.upsert) {
      return await OtpLockout.create({ identifier: cleanIdentifier, type, lockedUntil });
    }
    return null;
  },

  async deleteMany(filter = {}) {
    const { whereText, values } = buildWhereClause(filter);
    await query(`DELETE FROM otp_lockouts ${whereText}`, values);
  },
};

export default OtpLockout;
