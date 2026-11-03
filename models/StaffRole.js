import { query, toCamelCase } from '../config/db.js';
import { buildWhereClause, createQueryBuilder } from '../db/modelHelper.js';

export class StaffRoleInstance {
  constructor(data = {}) {
    Object.assign(this, toCamelCase(data));
  }

  async save() {
    const res = await query(
      `UPDATE staff_roles
       SET name = $1, description = $2, permissions = $3, is_system = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        this.name,
        this.description || '',
        Array.isArray(this.permissions) ? this.permissions : [],
        Boolean(this.isSystem),
        this.id || this._id,
      ]
    );
    if (res.rows.length > 0) {
      Object.assign(this, toCamelCase(res.rows[0]));
    }
    return this;
  }
}

const StaffRole = {
  async findById(id) {
    if (!id) return null;
    const res = await query(`SELECT * FROM staff_roles WHERE id = $1`, [id]);
    return res.rows.length ? new StaffRoleInstance(res.rows[0]) : null;
  },

  async findOne(filter = {}) {
    const { whereText, values } = buildWhereClause(filter);
    const sql = `SELECT * FROM staff_roles ${whereText} LIMIT 1`;
    const res = await query(sql, values);
    return res.rows.length ? new StaffRoleInstance(res.rows[0]) : null;
  },

  find(filter = {}) {
    return createQueryBuilder({
      tableName: 'staff_roles',
      filter,
      ModelClass: StaffRoleInstance,
    });
  },

  async create(data) {
    const res = await query(
      `INSERT INTO staff_roles (name, description, permissions, is_system, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING *`,
      [
        data.name ? data.name.trim() : '',
        data.description || '',
        Array.isArray(data.permissions) ? data.permissions : [],
        Boolean(data.isSystem),
      ]
    );
    return new StaffRoleInstance(res.rows[0]);
  },

  async findByIdAndUpdate(id, update = {}, options = {}) {
    const existing = await StaffRole.findById(id);
    if (!existing) return null;
    const fields = update.$set || update;
    Object.assign(existing, fields);
    return await existing.save();
  },

  async findByIdAndDelete(id) {
    if (!id) return null;
    const existing = await StaffRole.findById(id);
    if (!existing) return null;
    await query(`DELETE FROM staff_roles WHERE id = $1`, [id]);
    return existing;
  },
};

export default StaffRole;
