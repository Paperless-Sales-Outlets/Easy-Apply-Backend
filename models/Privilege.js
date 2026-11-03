import { query, toCamelCase } from '../config/db.js';
import { buildWhereClause, createQueryBuilder } from '../db/modelHelper.js';

export class PrivilegeInstance {
  constructor(data = {}) {
    Object.assign(this, toCamelCase(data));
  }

  async save() {
    const res = await query(
      `UPDATE privileges
       SET name = $1, description = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [this.name, this.description, this.id || this._id]
    );
    if (res.rows.length > 0) {
      Object.assign(this, toCamelCase(res.rows[0]));
    }
    return this;
  }
}

const Privilege = {
  async findById(id) {
    if (!id) return null;
    const res = await query(`SELECT * FROM privileges WHERE id = $1`, [id]);
    return res.rows.length ? new PrivilegeInstance(res.rows[0]) : null;
  },

  async findOne(filter = {}) {
    const { whereText, values } = buildWhereClause(filter);
    const sql = `SELECT * FROM privileges ${whereText} LIMIT 1`;
    const res = await query(sql, values);
    return res.rows.length ? new PrivilegeInstance(res.rows[0]) : null;
  },

  find(filter = {}) {
    return createQueryBuilder({
      tableName: 'privileges',
      filter,
      ModelClass: PrivilegeInstance,
    });
  },

  async create(data) {
    const res = await query(
      `INSERT INTO privileges (key, name, description, is_system, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (key) DO UPDATE
       SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = NOW()
       RETURNING *`,
      [
        data.key.toLowerCase().trim(),
        data.name.trim(),
        data.description || '',
        Boolean(data.isSystem),
      ]
    );
    return new PrivilegeInstance(res.rows[0]);
  },

  async insertMany(items = []) {
    const results = [];
    for (const item of items) {
      results.push(await Privilege.create(item));
    }
    return results;
  },

  async findByIdAndUpdate(id, update = {}, options = {}) {
    const existing = await Privilege.findById(id);
    if (!existing) return null;
    const fields = update.$set || update;
    Object.assign(existing, fields);
    return await existing.save();
  },

  async findByIdAndDelete(id) {
    if (!id) return null;
    const existing = await Privilege.findById(id);
    if (!existing) return null;
    await query(`DELETE FROM privileges WHERE id = $1`, [id]);
    return existing;
  },
};

export default Privilege;
