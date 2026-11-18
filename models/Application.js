import { query, toCamelCase } from '../config/db.js';
import {
  buildWhereClause,
  createQueryBuilder,
  createFindOneQueryBuilder,
  createFindByIdQueryBuilder,
  genericFindOneAndUpdate,
  formatColumnOrPath,
  toSnakeCase,
} from '../db/modelHelper.js';

export class ApplicationInstance {
  constructor(data = {}) {
    Object.assign(this, toCamelCase(data));
    this.formData = this.formData || {};
    this.documents = this.documents || {};
    this.paymentDetails = this.paymentDetails || {};
    this.officeFields = this.officeFields || {};
    this.salesAttribution = this.salesAttribution || {};
    this.salesOfficer = this.salesOfficerId || null;
  }

  async save() {
    if (!this.id && !this._id) {
      const created = await Application.create(this);
      Object.assign(this, created);
      return this;
    }

    const res = await query(
      `UPDATE applications
       SET status = $1, payment_status = $2, payment_details = $3,
           notes = $4, actioned_by = $5, actioned_at = $6,
           form_data = $7, documents = $8, office_fields = $9,
           sales_officer_id = $10, sales_officer_employee_number = $11,
           sales_tracking_token = $12, sales_attribution = $13,
           completed_sale = $14, completed_sale_at = $15, updated_at = NOW()
       WHERE id = $16
       RETURNING *`,
      [
        this.status || 'pending',
        this.paymentStatus || 'pending',
        JSON.stringify(this.paymentDetails || {}),
        this.notes || '',
        this.actionedBy || null,
        this.actionedAt || null,
        JSON.stringify(this.formData || {}),
        JSON.stringify(this.documents || {}),
        JSON.stringify(this.officeFields || {}),
        this.salesOfficerId || this.salesOfficer || null,
        this.salesOfficerEmployeeNumber || null,
        this.salesTrackingToken || null,
        JSON.stringify(this.salesAttribution || {}),
        Boolean(this.completedSale),
        this.completedSaleAt || null,
        this.id || this._id,
      ]
    );

    if (res.rows.length > 0) {
      Object.assign(this, toCamelCase(res.rows[0]));
    }
    return this;
  }
}

// Generate unique reference number like REQ-12345678
async function generateUniqueReferenceNumber() {
  let isUnique = false;
  let ref = '';
  while (!isUnique) {
    const randomDigits = Math.floor(10000000 + Math.random() * 90000000).toString();
    ref = `REQ-${randomDigits}`;
    const existing = await query(`SELECT id FROM applications WHERE reference_number = $1 LIMIT 1`, [ref]);
    if (existing.rows.length === 0) {
      isUnique = true;
    }
  }
  return ref;
}

class Application extends ApplicationInstance {
  constructor(data = {}) {
    super(data);
  }
}

Application.findById = function (id) {
  return createFindByIdQueryBuilder({
    tableName: 'applications',
    id,
    ModelClass: Application,
  });
};

Application.findOne = function (filter = {}) {
  return createFindOneQueryBuilder({
    tableName: 'applications',
    filter,
    ModelClass: Application,
  });
};

Application.find = function (filter = {}) {
  return createQueryBuilder({
    tableName: 'applications',
    filter,
    ModelClass: Application,
  });
};

Application.create = async function (data) {
  const ref = data.referenceNumber || (await generateUniqueReferenceNumber());
  const salesOfficerUuid = data.salesOfficerId || data.salesOfficer || null;

  const res = await query(
    `INSERT INTO applications (
      reference_number, phone, service_type, status, payment_status,
      payment_details, notes, actioned_by, actioned_at, nic,
      form_data, documents, office_fields, sales_officer_id,
      sales_officer_employee_number, sales_tracking_token, sales_attribution,
      completed_sale, completed_sale_at, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW())
     RETURNING *`,
    [
      ref,
      data.phone ? data.phone.trim() : '',
      data.serviceType || 'new-connection',
      data.status || 'pending',
      data.paymentStatus || 'pending',
      JSON.stringify(data.paymentDetails || {}),
      data.notes || '',
      data.actionedBy || null,
      data.actionedAt || null,
      data.nic ? data.nic.toUpperCase().trim() : '',
      JSON.stringify(data.formData || {}),
      JSON.stringify(data.documents || {}),
      JSON.stringify(data.officeFields || {}),
      salesOfficerUuid,
      data.salesOfficerEmployeeNumber || null,
      data.salesTrackingToken || null,
      JSON.stringify(data.salesAttribution || {}),
      Boolean(data.completedSale),
      data.completedSaleAt || null,
    ]
  );

  return new Application(res.rows[0]);
};

Application.countDocuments = function (filter = {}) {
  return createQueryBuilder({
    tableName: 'applications',
    filter,
    countQuery: true,
  });
};

Application.distinct = async function (field, filter = {}) {
  const col = field === '_id' ? 'id' : field.includes('.') ? formatColumnOrPath(field) : toSnakeCase(field);
  const { whereText, values } = buildWhereClause(filter);
  const sql = `SELECT DISTINCT ${col} as val FROM applications ${whereText ? `${whereText} AND` : 'WHERE'} ${col} IS NOT NULL`;
  const res = await query(sql, values);
  return res.rows.map((r) => r.val);
};

Application.findOneAndUpdate = async function (filter, update = {}, options = {}) {
  return genericFindOneAndUpdate('applications', filter, update, options, Application);
};

Application.findByIdAndUpdate = async function (id, update = {}, options = {}) {
  const existing = await Application.findById(id);
  if (!existing) return null;
  const fields = update.$set || update;
  Object.assign(existing, fields);
  return await existing.save();
};

Application.findByIdAndDelete = async function (id) {
  if (!id) return null;
  const existing = await Application.findById(id);
  if (!existing) return null;
  await query(`DELETE FROM applications WHERE id = $1`, [id]);
  return existing;
};

Application.deleteMany = async function (filter = {}) {
  const { whereText, values } = buildWhereClause(filter);
  await query(`DELETE FROM applications ${whereText}`, values);
};

// Generic aggregate handler for dashboard stats & sales officer metrics
Application.aggregate = async function (pipeline = []) {
  if (pipeline.length === 1 && pipeline[0].$group && pipeline[0].$group._id === '$status') {
    const res = await query(`SELECT status as "_id", COUNT(*)::int as count FROM applications GROUP BY status`);
    return res.rows;
  }

  if (pipeline.length === 2 && pipeline[0].$match && pipeline[1].$group && pipeline[1].$group._id === '$status') {
    const { whereText, values } = buildWhereClause(pipeline[0].$match);
    const res = await query(`SELECT status as "_id", COUNT(*)::int as count FROM applications ${whereText} GROUP BY status`, values);
    return res.rows;
  }

  return [];
};

export default Application;
