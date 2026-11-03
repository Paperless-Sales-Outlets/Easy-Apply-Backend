import { query, toCamelCase } from '../config/db.js';
import { buildWhereClause } from '../db/modelHelper.js';

const RefreshToken = {
  async findOne(filter = {}) {
    const { whereText, values } = buildWhereClause(filter);
    const sql = `SELECT * FROM refresh_tokens ${whereText} LIMIT 1`;
    const res = await query(sql, values);
    return res.rows.length ? toCamelCase(res.rows[0]) : null;
  },

  async create(data) {
    const res = await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (token) DO UPDATE
       SET expires_at = EXCLUDED.expires_at
       RETURNING *`,
      [data.userId, data.token, data.expiresAt]
    );
    return toCamelCase(res.rows[0]);
  },

  async deleteOne(filter = {}) {
    const { whereText, values } = buildWhereClause(filter);
    await query(`DELETE FROM refresh_tokens ${whereText}`, values);
  },

  async deleteMany(filter = {}) {
    const { whereText, values } = buildWhereClause(filter);
    await query(`DELETE FROM refresh_tokens ${whereText}`, values);
  },
};

export default RefreshToken;
