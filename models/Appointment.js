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

export class AppointmentInstance {
  constructor(data = {}) {
    Object.assign(this, toCamelCase(data));
    this.feedback = this.feedback || {};
  }

  async save() {
    if (!this.id && !this._id) {
      const created = await Appointment.create(this);
      Object.assign(this, created);
      return this;
    }

    const res = await query(
      `UPDATE appointments
       SET application_id = $1, reference_number = $2, customer_name = $3,
           phone = $4, address = $5, service_type = $6, scheduled_at = $7,
           time_slot = $8, landmark_notes = $9, dispatch_id = $10,
           technician_id = $11, status = $12, feedback = $13,
           notes = $14, updated_at = NOW()
       WHERE id = $15
       RETURNING *`,
      [
        this.applicationId || null,
        this.referenceNumber || '',
        this.customerName || '',
        this.phone || '',
        this.address || '',
        this.serviceType || 'new-connection',
        this.scheduledAt,
        this.timeSlot || 'Morning (08.30 AM - 12.00 PM)',
        this.landmarkNotes || '',
        this.dispatchId || '',
        this.technicianId || null,
        this.status || 'scheduled',
        JSON.stringify(this.feedback || {}),
        this.notes || '',
        this.id || this._id,
      ]
    );

    if (res.rows.length > 0) {
      Object.assign(this, toCamelCase(res.rows[0]));
    }
    return this;
  }
}

class Appointment extends AppointmentInstance {
  constructor(data = {}) {
    super(data);
  }
}

Appointment.findById = function (id) {
  return createFindByIdQueryBuilder({
    tableName: 'appointments',
    id,
    ModelClass: Appointment,
  });
};

Appointment.findOne = function (filter = {}) {
  return createFindOneQueryBuilder({
    tableName: 'appointments',
    filter,
    ModelClass: Appointment,
  });
};

Appointment.find = function (filter = {}) {
  return createQueryBuilder({
    tableName: 'appointments',
    filter,
    ModelClass: Appointment,
  });
};

Appointment.countDocuments = function (filter = {}) {
  return createQueryBuilder({
    tableName: 'appointments',
    filter,
    countQuery: true,
  });
};

Appointment.create = async function (data) {
  const res = await query(
    `INSERT INTO appointments (
      application_id, reference_number, customer_name, phone, address,
      service_type, scheduled_at, time_slot, landmark_notes, dispatch_id,
      technician_id, status, feedback, notes, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
     RETURNING *`,
    [
      data.applicationId || null,
      data.referenceNumber ? data.referenceNumber.trim() : '',
      data.customerName ? data.customerName.trim() : '',
      data.phone ? data.phone.trim() : '',
      data.address ? data.address.trim() : '',
      data.serviceType || 'new-connection',
      data.scheduledAt || new Date(),
      data.timeSlot || 'Morning (08.30 AM - 12.00 PM)',
      data.landmarkNotes || '',
      data.dispatchId || '',
      data.technicianId || null,
      data.status || 'scheduled',
      JSON.stringify(data.feedback || {}),
      data.notes || '',
    ]
  );

  return new Appointment(res.rows[0]);
};

Appointment.findByIdAndUpdate = async function (id, update = {}, options = {}) {
  const existing = await Appointment.findById(id);
  if (!existing) return null;
  const fields = update.$set || update;
  Object.assign(existing, fields);
  return await existing.save();
};

Appointment.findOneAndUpdate = async function (filter, update = {}, options = {}) {
  return genericFindOneAndUpdate('appointments', filter, update, options, Appointment);
};

Appointment.distinct = async function (field, filter = {}) {
  const col = field === '_id' ? 'id' : field.includes('.') ? formatColumnOrPath(field) : toSnakeCase(field);
  const { whereText, values } = buildWhereClause(filter);
  const sql = `SELECT DISTINCT ${col} as val FROM appointments ${whereText ? `${whereText} AND` : 'WHERE'} ${col} IS NOT NULL`;
  const res = await query(sql, values);
  return res.rows.map((r) => r.val);
};

Appointment.deleteMany = async function (filter = {}) {
  const { whereText, values } = buildWhereClause(filter);
  await query(`DELETE FROM appointments ${whereText}`, values);
};

export default Appointment;
