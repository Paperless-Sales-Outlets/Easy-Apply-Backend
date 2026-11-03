import { query, toCamelCase } from '../config/db.js';
import { buildWhereClause, createQueryBuilder } from '../db/modelHelper.js';

const AuditLog = {
  async create(data) {
    const res = await query(
      `INSERT INTO audit_logs (action, actor_id, actor_role, ip_address, details, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [
        data.action,
        data.actorId || data.userId || null,
        data.actorRole || data.role || 'System',
        data.ipAddress || '',
        JSON.stringify(data.details || {}),
      ]
    );
    return toCamelCase(res.rows[0]);
  },

  find(filter = {}) {
    return createQueryBuilder({
      tableName: 'audit_logs',
      filter,
    });
  },

  async countDocuments(filter = {}) {
    return createQueryBuilder({
      tableName: 'audit_logs',
      filter,
      countQuery: true,
    });
  },
};

export default AuditLog;
