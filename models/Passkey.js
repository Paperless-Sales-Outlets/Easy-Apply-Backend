import mongoose from 'mongoose';

const passkeySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    credentialID: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    credentialPublicKey: {
      type: Buffer,
      required: true,
    },
    counter: {
      type: Number,
      required: true,
      default: 0,
    },
    deviceType: {
      type: String,
      default: 'singleDevice',
    },
    backedUp: {
      type: Boolean,
      default: false,
    },
    transports: {
      type: [String],
      default: [],
    },
    deviceName: {
      type: String,
      trim: true,
      default: 'Passkey Device',
    },
    lastUsedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'passkeys',
  }
);

const Passkey = mongoose.model('Passkey', passkeySchema);

export default Passkey;

