import { query, toCamelCase } from '../config/db.js';
import {
  buildWhereClause,
  createQueryBuilder,
  createFindOneQueryBuilder,
  createFindByIdQueryBuilder,
} from '../db/modelHelper.js';

export const LEAD_STATUSES = [
  'new',
  'survey-scheduled',
  'survey-in-progress',
  'survey-completed',
  'qualified',
  'conditional',
  'not-feasible',
  'approved',
  'converted',
  'on-hold',
];

export const LEAD_CHECK_STATUSES = [
  'pending',
  'pass',
  'marginal',
  'fail',
  'waived',
  'na',
];

export const LEAD_RISK_LEVELS = ['none', 'low', 'medium', 'high', 'critical'];

export const LEAD_RESOLUTIONS = [
  'resurvey',
  'alternative-package',
  'alternative-technology',
  'engineering-review',
  'waived',
  'rejected',
];

export const LEAD_SOURCES = [
  'portal',
  'call-centre',
  'field-sales',
  'partner',
  'referral',
  'walk-in',
];

export const LEAD_TECHNOLOGIES = ['FTTH', 'FTTC', 'Copper', 'Wireless', 'Other'];

export const LEAD_CHECK_CATALOG = [
  {
    key: 'signal-strength',
    label: 'Optical Signal Strength',
    type: 'numeric',
    unit: 'dBm',
    metric: 'ONT receive power measured at the premises',
    threshold: 'Pass at -27 dBm or above, marginal to -30 dBm, fail below',
    scale: { direction: 'above', good: -27, warn: -30 },
    critical: true,
  },
  {
    key: 'splitter-capacity',
    label: 'Splitter / PON Port Capacity',
    type: 'numeric',
    unit: '1:x',
    valuePrefix: '1:',
    metric: 'Split ratio and free port count at the distribution point',
    threshold: 'Pass at 1:8 or below, marginal to 1:16, fail above',
    scale: { direction: 'below', good: 8, warn: 16 },
    critical: true,
  },
  {
    key: 'drop-distance',
    label: 'Drop Cable Distance',
    type: 'numeric',
    unit: 'm',
    metric: 'Fibre length from the distribution point to the premises',
    threshold: 'Pass up to 1000 m, marginal to 1500 m, fail beyond',
    scale: { direction: 'below', good: 1000, warn: 1500 },
    critical: false,
  },
  {
    key: 'infrastructure',
    label: 'Existing Fibre Infrastructure',
    type: 'select',
    options: ['available', 'partial', 'not-available'],
    optionStatus: { available: 'pass', partial: 'marginal', 'not-available': 'fail' },
    metric: 'Is there an existing drop or an in-building riser?',
    threshold: 'Pass when a drop is already available',
    critical: false,
  },
  {
    key: 'power',
    label: 'Power Availability at Premises',
    type: 'select',
    options: ['available', 'unstable', 'not-available'],
    optionStatus: { available: 'pass', unstable: 'marginal', 'not-available': 'fail' },
    metric: 'Is there a grounded mains point for the ONT and router?',
    threshold: 'Pass when a stable grounded supply is present',
    critical: true,
  },
  {
    key: 'exchange-capacity',
    label: 'Exchange / Cabinet Port Availability',
    type: 'select',
    options: ['available', 'limited', 'unavailable'],
    optionStatus: { available: 'pass', limited: 'marginal', unavailable: 'fail' },
    metric: 'Free PON port and rack space at the serving exchange',
    threshold: 'Pass when a free port and rack space exist',
    critical: true,
  },
  {
    key: 'site-access',
    label: 'Site Access & Terrain',
    type: 'select',
    options: ['easy', 'moderate', 'difficult', 'inaccessible'],
    optionStatus: { easy: 'pass', moderate: 'pass', difficult: 'marginal', inaccessible: 'fail' },
    metric: 'How hard is it to reach and terminate the drop',
    threshold: 'Pass at easy or moderate access',
    critical: false,
  },
  {
    key: 'right-of-way',
    label: 'Right of Way & Cable Route',
    type: 'select',
    options: ['clear', 'permission-required', 'obstructed'],
    optionStatus: { clear: 'pass', 'permission-required': 'marginal', obstructed: 'fail' },
    metric: 'Can the cable be run from the distribution point',
    threshold: 'Pass when the route is clear',
    critical: false,
  },
  {
    key: 'address-verification',
    label: 'Address & Geo Verification',
    type: 'select',
    options: ['verified', 'unverified', 'mismatch'],
    optionStatus: { verified: 'pass', unverified: 'marginal', mismatch: 'fail' },
    metric: 'Does the address match the network coverage record',
    threshold: 'Pass when the address is verified',
    critical: false,
  },
];

export const LEAD_CHECK_KEYS = LEAD_CHECK_CATALOG.map((c) => c.key);

export class LeadInstance {
  constructor(data = {}) {
    Object.assign(this, toCamelCase(data));
    this.checks = Array.isArray(this.checks) ? this.checks : [];
    this.location = this.location || {};
    this.metadata = this.metadata || {};
  }

  async save() {
    const res = await query(
      `UPDATE leads
       SET customer_name = $1, phone = $2, email = $3, address = $4,
           status = $5, technology = $6, risk_level = $7, checks = $8,
           location = $9, metadata = $10, updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        this.customerName,
        this.phone,
        this.email || '',
        this.address,
        this.status || 'new',
        this.technology || 'FTTH',
        this.riskLevel || 'none',
        JSON.stringify(this.checks || []),
        JSON.stringify(this.location || {}),
        JSON.stringify(this.metadata || {}),
        this.id || this._id,
      ]
    );

    if (res.rows.length > 0) {
      Object.assign(this, toCamelCase(res.rows[0]));
    }
    return this;
  }
}

const Lead = {
  findById(id) {
    return createFindByIdQueryBuilder({
      tableName: 'leads',
      id,
      ModelClass: LeadInstance,
    });
  },

  findOne(filter = {}) {
    return createFindOneQueryBuilder({
      tableName: 'leads',
      filter,
      ModelClass: LeadInstance,
    });
  },

  find(filter = {}) {
    return createQueryBuilder({
      tableName: 'leads',
      filter,
      ModelClass: LeadInstance,
    });
  },

  async create(data) {
    const ref = data.referenceNumber || `LEAD-${Date.now()}`;

    const res = await query(
      `INSERT INTO leads (
        reference_number, customer_name, phone, email, address,
        status, technology, risk_level, checks, location, metadata,
        created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
       ON CONFLICT (reference_number) DO UPDATE
       SET customer_name = EXCLUDED.customer_name, updated_at = NOW()
       RETURNING *`,
      [
        ref,
        data.customerName ? data.customerName.trim() : '',
        data.phone ? data.phone.trim() : '',
        data.email || '',
        data.address || '',
        data.status || 'new',
        data.technology || 'FTTH',
        data.riskLevel || 'none',
        JSON.stringify(data.checks || []),
        JSON.stringify(data.location || {}),
        JSON.stringify(data.metadata || {}),
      ]
    );

    return new LeadInstance(res.rows[0]);
  },

  async countDocuments(filter = {}) {
    return createQueryBuilder({
      tableName: 'leads',
      filter,
      countQuery: true,
    });
  },

  async findByIdAndUpdate(id, update = {}, options = {}) {
    const existing = await Lead.findById(id);
    if (!existing) return null;
    const fields = update.$set || update;
    Object.assign(existing, fields);
    return await existing.save();
  },

  async findByIdAndDelete(id) {
    if (!id) return null;
    const existing = await Lead.findById(id);
    if (!existing) return null;
    await query(`DELETE FROM leads WHERE id = $1`, [id]);
    return existing;
  },
};

export default Lead;
