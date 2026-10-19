import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog.js';

const actorFrom = (req, actor) => actor || req?.user || req?.customer || null;

export const recordAudit = async ({
  req,
  actor,
  action,
  module,
  targetId,
  requestId,
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
    requestId,
    description,
    metadata,
  });
};

const requestIdFrom = (req) => {
  const headerId = req?.get?.('Idempotency-Key') || req?.get?.('X-Request-Id');
  const bodyId = req?.body?.requestId;
  const requestId = headerId || bodyId;

  if (!requestId || typeof requestId !== 'string') return null;
  const normalized = requestId.trim();
  return normalized ? normalized.slice(0, 200) : null;
};

const safeCustomerDetails = (req) => {
  const account = actorFrom(req);
  const bodyCustomerId = req?.body?.customerId;
  const bodyCustomerName = req?.body?.customerName;
  const hasAccount = account && account._id;
  const customerId = hasAccount
    ? account._id
    : mongoose.isValidObjectId(bodyCustomerId)
      ? bodyCustomerId
      : null;

  return {
    userId: customerId,
    userName: hasAccount ? account.name || null : bodyCustomerName || null,
  };
};

// Loop Check is a public endpoint, so audit failures must never change its
// response. A request id is used only when supplied by the client; requests
// without one remain separately auditable legitimate checks.
export const recordLoopCheckAudit = async ({
  req,
  targetId,
  result,
  status,
  error,
}) => {
  const customer = safeCustomerDetails(req);
  const requestId = requestIdFrom(req);

  if (mongoose.connection.readyState !== 1) {
    console.warn('Loop Check audit logging skipped because the database is unavailable');
    return;
  }

  try {
    await AuditLog.create({
      userId: customer.userId,
      userName: customer.userName,
      action: 'LOOP_CHECK',
      module: 'New Connection',
      targetId: targetId == null ? null : String(targetId),
      requestId,
      description: status === 'SUCCESS'
        ? 'Performed Loop Check'
        : 'Loop Check request failed',
      metadata: {
        result: result || null,
        status,
        ...(error
          ? {
              error: {
                name: error.name || 'RequestError',
                code: error.code || null,
              },
            }
          : {}),
      },
    });
  } catch (auditError) {
    // Audit persistence is deliberately isolated from the customer response.
    console.error('Loop Check audit logging failed:', auditError);
  }
};
