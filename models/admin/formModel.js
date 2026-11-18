import { query, toCamelCase } from '../../config/db.js';
import {
  buildWhereClause,
  createQueryBuilder,
  createFindOneQueryBuilder,
  createFindByIdQueryBuilder,
  genericFindOneAndUpdate,
  toSnakeCase,
} from '../../db/modelHelper.js';

export class FormInstance {
  constructor(data = {}) {
    Object.assign(this, toCamelCase(data));
    this.data = this.data || {};
    this.comments = Array.isArray(this.comments) ? this.comments : [];
  }

  async save() {
    const res = await query(
      `UPDATE forms
       SET form_type = $1, data = $2, status = $3, created_by = $4,
           comments = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        this.formType,
        JSON.stringify(this.data || {}),
        this.status || 'pending',
        this.createdBy || null,
        JSON.stringify(this.comments || []),
        this.id || this._id,
      ]
    );

    if (res.rows.length > 0) {
      Object.assign(this, toCamelCase(res.rows[0]));
    }
    return this;
  }
}

const Form = {
  findById(id) {
    return createFindByIdQueryBuilder({
      tableName: 'forms',
      id,
      ModelClass: FormInstance,
    });
  },

  findOne(filter = {}) {
    return createFindOneQueryBuilder({
      tableName: 'forms',
      filter,
      ModelClass: FormInstance,
    });
  },

  find(filter = {}) {
    return createQueryBuilder({
      tableName: 'forms',
      filter,
      ModelClass: FormInstance,
    });
  },

  async countDocuments(filter = {}) {
    return createQueryBuilder({
      tableName: 'forms',
      filter,
      countQuery: true,
    });
  },

  async create(data) {
    const res = await query(
      `INSERT INTO forms (form_type, data, status, created_by, comments, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING *`,
      [
        data.formType || 'general',
        JSON.stringify(data.data || {}),
        data.status || 'pending',
        data.createdBy || null,
        JSON.stringify(data.comments || []),
      ]
    );
    return new FormInstance(res.rows[0]);
  },

  async findByIdAndUpdate(id, update = {}, options = {}) {
    const existing = await Form.findById(id);
    if (!existing) return null;
    const fields = update.$set || update;
    Object.assign(existing, fields);
    return await existing.save();
  },

  async findOneAndUpdate(filter, update = {}, options = {}) {
    return genericFindOneAndUpdate('forms', filter, update, options, FormInstance);
  },

  async deleteMany(filter = {}) {
    const { whereText, values } = buildWhereClause(filter);
    await query(`DELETE FROM forms ${whereText}`, values);
  },
};

export default Form;
