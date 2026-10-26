import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userName: { type: String, trim: true, default: null },
    action: { type: String, required: true, uppercase: true, trim: true },
    module: { type: String, required: true, trim: true },
    targetId: { type: String, trim: true, default: null },
    description: { type: String, required: true, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: undefined },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { collection: 'audit_logs', versionKey: false }
);

auditLogSchema.index({ action: 1, module: 1, timestamp: -1 });
auditLogSchema.index({ userId: 1, timestamp: -1 });
auditLogSchema.index({ targetId: 1, timestamp: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

export default AuditLog;
