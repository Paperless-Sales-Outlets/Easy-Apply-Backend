import mongoose from 'mongoose';

export const DRAFT_STATUS = {
  ACTIVE: 'active', // the customer can see and continue it
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
 * A customer has at most one active draft, which can be continued until it is
 * submitted or explicitly deleted.
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
  },
  {
    timestamps: true,
    // Mixed fields with nested objects must not be pruned when empty.
    minimize: false,
  }
);

// At most one active draft per mobile number.
newConnectionDraftSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { status: DRAFT_STATUS.ACTIVE }, name: 'phone_active_unique' }
);

const NewConnectionDraft = mongoose.model('NewConnectionDraft', newConnectionDraftSchema);

export default NewConnectionDraft;
