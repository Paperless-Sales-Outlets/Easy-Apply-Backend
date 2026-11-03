import { query, toCamelCase } from '../../config/db.js';
import {
  buildWhereClause,
  createQueryBuilder,
  createFindOneQueryBuilder,
  createFindByIdQueryBuilder,
  genericFindOneAndUpdate,
  formatColumnOrPath,
  toSnakeCase,
} from '../../db/modelHelper.js';

export class KycReviewInstance {
  constructor(data = {}) {
    Object.assign(this, toCamelCase(data));
    this.checks = Array.isArray(this.checks) ? this.checks : [];
    this.history = Array.isArray(this.history) ? this.history : [];
    this.caseInfo = this.caseInfo || null;
  }

  async save() {
    const res = await query(
      `UPDATE kyc_reviews
       SET subject_type = $1, subject_id = $2, decided_by = $3,
           decided_by_name = $4, decided_by_id = $5, decided_at = $6,
           auto_decision = $7, auto_checked_at = $8, case_info = $9,
           checks = $10, history = $11, updated_at = NOW()
       WHERE id = $12
       RETURNING *`,
      [
        this.subjectType,
        this.subjectId,
        this.decidedBy || null,
        this.decidedByName || null,
        this.decidedById || null,
        this.decidedAt || new Date(),
        this.autoDecision || null,
        this.autoCheckedAt || null,
        this.caseInfo ? JSON.stringify(this.caseInfo) : null,
        JSON.stringify(this.checks || []),
        JSON.stringify(this.history || []),
        this.id || this._id,
      ]
    );

    if (res.rows.length > 0) {
      Object.assign(this, toCamelCase(res.rows[0]));
    }
    return this;
  }
}

const KycReview = {
  findById(id) {
    return createFindByIdQueryBuilder({
      tableName: 'kyc_reviews',
      id,
      ModelClass: KycReviewInstance,
    });
  },

  findOne(filter = {}) {
    return createFindOneQueryBuilder({
      tableName: 'kyc_reviews',
      filter,
      ModelClass: KycReviewInstance,
    });
  },

  find(filter = {}) {
    return createQueryBuilder({
      tableName: 'kyc_reviews',
      filter,
      ModelClass: KycReviewInstance,
    });
  },

  async create(data) {
    const res = await query(
      `INSERT INTO kyc_reviews (
        subject_type, subject_id, decided_by, decided_by_name, decided_by_id,
        decided_at, auto_decision, auto_checked_at, case_info, checks, history,
        created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
       RETURNING *`,
      [
        data.subjectType,
        data.subjectId,
        data.decidedBy || null,
        data.decidedByName || null,
        data.decidedById || null,
        data.decidedAt || new Date(),
        data.autoDecision || null,
        data.autoCheckedAt || null,
        data.caseInfo ? JSON.stringify(data.caseInfo) : null,
        JSON.stringify(data.checks || []),
        JSON.stringify(data.history || []),
      ]
    );
    return new KycReviewInstance(res.rows[0]);
  },

  async findOneAndUpdate(filter, update = {}, options = {}) {
    return genericFindOneAndUpdate('kyc_reviews', filter, update, options, KycReviewInstance);
  },

  async distinct(field, filter = {}) {
    const col = field === '_id' ? 'id' : field.includes('.') ? formatColumnOrPath(field) : toSnakeCase(field);
    const { whereText, values } = buildWhereClause(filter);
    const sql = `SELECT DISTINCT ${col} as val FROM kyc_reviews ${whereText ? `${whereText} AND` : 'WHERE'} ${col} IS NOT NULL`;
    const res = await query(sql, values);
    return res.rows.map((r) => r.val);
  },

  async deleteMany(filter = {}) {
    const { whereText, values } = buildWhereClause(filter);
    await query(`DELETE FROM kyc_reviews ${whereText}`, values);
  },
};

export default KycReview;
