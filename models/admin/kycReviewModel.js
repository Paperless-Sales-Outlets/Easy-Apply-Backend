import mongoose from 'mongoose';

// Audit record for one KYC case. The decision itself still lives where it
// always has (Application.status / Customer.kycStatus) so nothing else in the
// app changes; this collection adds the part that was missing — *who* decided
// (the automated system or a named admin), *why*, and every change since.
//
// A case is either a service application or a registered customer account
// that has captured ID images but no application yet.
const checkSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    // pass   – verified and consistent
    // fail   – a definite contradiction (the only thing that justifies rejecting)
    // unsure – missing or ambiguous data (flags the case for a person)
    // manual – cannot be machine-verified here; never blocks approval
    result: { type: String, enum: ['pass', 'fail', 'unsure', 'manual'], required: true },
    detail: { type: String, default: '' },
  },
  { _id: false }
);

const historySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    // 'system' = decided by the automated review; 'admin' = a person.
    actor: { type: String, enum: ['system', 'admin'], required: true },
    actorName: { type: String, default: '' },
    actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    kind: { type: String, enum: ['auto', 'rerun', 'manual'], required: true },
    fromStatus: { type: String, default: '' },
    toStatus: { type: String, required: true },
    remark: { type: String, default: '', maxlength: 2000 },
  },
  { _id: false }
);

const kycReviewSchema = new mongoose.Schema(
  {
    subjectType: { type: String, enum: ['application', 'account'], required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, required: true },

    // Who made the decision that is currently in force (null = no decision
    // has been recorded by either; the status predates the review log).
    decidedBy: { type: String, enum: ['system', 'admin', null], default: null },
    decidedByName: { type: String, default: '' },
    decidedById: { type: mongoose.Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: Date.now },

    // Latest automated verdict, kept even after a person overrides it so the
    // admin can compare the two.
    autoDecision: { type: String, enum: ['approved', 'rejected', 'flagged'], default: null },
    autoCheckedAt: { type: Date, default: null },
    checks: { type: [checkSchema], default: [] },

    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

kycReviewSchema.index({ subjectType: 1, subjectId: 1 }, { unique: true });

const KycReview = mongoose.models.KycReview || mongoose.model('KycReview', kycReviewSchema);

export default KycReview;
