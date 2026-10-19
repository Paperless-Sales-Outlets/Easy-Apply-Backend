import mongoose from 'mongoose';

// How long a customer can continue an unfinished application, counted from
// the day they started it. Never extended by later saves.
export const DRAFT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const DRAFT_STATUS = {
  ACTIVE: 'active', // the customer can see and continue it
  EXPIRED: 'expired', // past its 30 days: hidden from the customer, kept on record
};

// A photo saved with the draft. Captured images are kept as GridFS files so
// three NIC/selfie images never push the draft past MongoDB's 16MB document
// limit; a value that is already a reference (e.g. a GridFS id copied from the
// customer's profile) is stored as-is.
const draftPhotoSchema = new mongoose.Schema(
  {
    fileId: { type: mongoose.Schema.Types.ObjectId },
    ref: { type: String },
  },
  { _id: false }
);

/**
 * An unfinished New Connection application, so a customer can leave the wizard
 * and pick it up later from any device after verifying their mobile number again.
 *
 * Kept apart from Application on purpose: drafts must never show up in admin
 * lists, KYC review or reports, and they don't have the NIC / reference number
 * an Application requires.
 *
 * Lifecycle: a draft is `active` for 30 days from when it was started
 * (`resumeUntil`). After that it becomes `expired` — the customer no longer
 * sees it and can't continue it, but the record and its photos are kept so it
 * can still be retrieved if needed. A customer has at most one active draft;
 * expired ones accumulate as history.
 */
const newConnectionDraftSchema = new mongoose.Schema(
  {
    // Mobile number (9-digit national form). Always taken from the
    // OTP-verified draft token, never from the request body.
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(DRAFT_STATUS),
      default: DRAFT_STATUS.ACTIVE,
    },
    // Everything the wizard holds except the photos below.
    formData: { type: mongoose.Schema.Types.Mixed, default: {} },
    selectedProduct: { type: mongoose.Schema.Types.Mixed, default: null },
    stepIndex: { type: Number, default: 0, min: 0 },
    photos: {
      nicFront: { type: draftPhotoSchema, default: undefined },
      nicBack: { type: draftPhotoSchema, default: undefined },
      facePhoto: { type: draftPhotoSchema, default: undefined },
    },
    // Last moment the customer can continue: 30 days after the draft was
    // started. Set once when the draft is created.
    resumeUntil: {
      type: Date,
      default: () => new Date(Date.now() + DRAFT_LIFETIME_MS),
    },
    // When the draft was marked expired.
    expiredAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    // Mixed fields with nested objects must not be pruned when empty.
    minimize: false,
  }
);

// At most one active draft per mobile number; expired drafts don't count, so a
// customer can start again after one expires while the old one stays on record.
newConnectionDraftSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { status: DRAFT_STATUS.ACTIVE }, name: 'phone_active_unique' }
);

// For the scheduled job that marks drafts past their 30 days as expired.
newConnectionDraftSchema.index({ status: 1, resumeUntil: 1 });

const NewConnectionDraft = mongoose.model('NewConnectionDraft', newConnectionDraftSchema);

export default NewConnectionDraft;
