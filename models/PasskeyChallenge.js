// Short-lived, single-use WebAuthn challenges (PostgreSQL `passkey_challenges` table).
import { query, toCamelCase } from '../config/db.js';

const PasskeyChallenge = {
  async create(data) {
    const res = await query(
      `INSERT INTO passkey_challenges (challenge, user_id, type, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.challenge, data.userId || null, data.type, data.expiresAt]
    );
    // Opportunistic cleanup so abandoned challenges don't accumulate.
    query('DELETE FROM passkey_challenges WHERE expires_at < NOW()').catch(() => {});
    return toCamelCase(res.rows[0]);
  },

  async findOne(filter = {}) {
    const clauses = [];
    const values = [];
    const add = (column, value) => {
      values.push(value);
      clauses.push(`${column} = $${values.length}`);
    };
    if (filter._id) add('id', filter._id);
    if (filter.userId) add('user_id', filter.userId);
    if (filter.type) add('type', filter.type);
    if (!clauses.length) return null;
    const res = await query(`SELECT * FROM passkey_challenges WHERE ${clauses.join(' AND ')} LIMIT 1`, values);
    return res.rows.length ? toCamelCase(res.rows[0]) : null;
  },

  async deleteOne(filter = {}) {
    if (!filter._id) throw new Error('PasskeyChallenge.deleteOne requires _id');
    await query('DELETE FROM passkey_challenges WHERE id = $1', [filter._id]);
  },
};

export default PasskeyChallenge;
