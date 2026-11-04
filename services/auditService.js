import AuditLog from '../models/AuditLog.js';

const actorFrom = (req, actor) => actor || req?.user || req?.customer || null;

/**
 * Writes an audit-log entry for an action. The actor is taken from `actor`,
 * falling back to the authenticated user on `req`. Rejects if the insert fails,
 * so callers decide whether an audit failure should block their operation.
 */
export const recordAudit = async ({
  req,
  actor,
  action,
  module,
  targetId,
  description,
  metadata,
}) => {
  const account = actorFrom(req, actor);
  const actorId = account?._id || null;
  return AuditLog.create({
    userId: actorId,
    adminId: account && ['admin', 'staff'].includes(String(account.role).toLowerCase()) ? actorId : null,
    userName: account?.name || null,
    action,
    module,
    targetId: targetId == null ? null : String(targetId),
    description,
    metadata,
  });
};
