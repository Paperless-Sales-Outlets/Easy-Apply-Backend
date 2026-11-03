import { query, toCamelCase } from '../config/db.js';
import {
  buildWhereClause,
  createQueryBuilder,
  createFindOneQueryBuilder,
  createFindByIdQueryBuilder,
} from '../db/modelHelper.js';

export const DRAFT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const DRAFT_STATUS = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
};

export class DraftInstance {
  constructor(data = {}) {
    Object.assign(this, toCamelCase(data));
    this.formData = this.formData || {};
    this.photos = this.photos || {};
  }

  async save() {
    const res = await query(
      `UPDATE new_connection_drafts
       SET status = $1, form_data = $2, selected_product = $3,
           step_index = $4, photos = $5, resume_until = $6,
           expired_at = $7, updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        this.status || DRAFT_STATUS.ACTIVE,
        JSON.stringify(this.formData || {}),
        this.selectedProduct ? JSON.stringify(this.selectedProduct) : null,
        Number(this.stepIndex || 0),
        JSON.stringify(this.photos || {}),
        this.resumeUntil || new Date(Date.now() + DRAFT_LIFETIME_MS),
        this.expiredAt || null,
        this.id || this._id,
      ]
    );

    if (res.rows.length > 0) {
      Object.assign(this, toCamelCase(res.rows[0]));
    }
    return this;
  }
}

const NewConnectionDraft = {
  findById(id) {
    return createFindByIdQueryBuilder({
      tableName: 'new_connection_drafts',
      id,
      ModelClass: DraftInstance,
    });
  },

  findOne(filter = {}) {
    return createFindOneQueryBuilder({
      tableName: 'new_connection_drafts',
      filter,
      ModelClass: DraftInstance,
    });
  },

  find(filter = {}) {
    return createQueryBuilder({
      tableName: 'new_connection_drafts',
      filter,
      ModelClass: DraftInstance,
    });
  },

  async create(data) {
    const resumeUntil = data.resumeUntil || new Date(Date.now() + DRAFT_LIFETIME_MS);

    const res = await query(
      `INSERT INTO new_connection_drafts (
        phone, status, form_data, selected_product, step_index,
        photos, resume_until, expired_at, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING *`,
      [
        data.phone ? data.phone.trim() : '',
        data.status || DRAFT_STATUS.ACTIVE,
        JSON.stringify(data.formData || {}),
        data.selectedProduct ? JSON.stringify(data.selectedProduct) : null,
        Number(data.stepIndex || 0),
        JSON.stringify(data.photos || {}),
        resumeUntil,
        data.expiredAt || null,
      ]
    );

    return new DraftInstance(res.rows[0]);
  },

  async countDocuments(filter = {}) {
    return createQueryBuilder({
      tableName: 'new_connection_drafts',
      filter,
      countQuery: true,
    });
  },

  async findByIdAndUpdate(id, update = {}, options = {}) {
    const existing = await NewConnectionDraft.findById(id);
    if (!existing) return null;
    const fields = update.$set || update;
    Object.assign(existing, fields);
    return await existing.save();
  },

  async findByIdAndDelete(id) {
    if (!id) return null;
    const existing = await NewConnectionDraft.findById(id);
    if (!existing) return null;
    await query(`DELETE FROM new_connection_drafts WHERE id = $1`, [id]);
    return existing;
  },

  async updateMany(filter = {}, update = {}) {
    const { whereText, values } = buildWhereClause(filter);
    const fields = update.$set || update;
    if (fields.status) {
      const idx = values.length + 1;
      await query(
        `UPDATE new_connection_drafts 
         SET status = $${idx}, expired_at = NOW(), updated_at = NOW() 
         ${whereText}`,
        [...values, fields.status]
      );
    }
  },
};

export default NewConnectionDraft;
