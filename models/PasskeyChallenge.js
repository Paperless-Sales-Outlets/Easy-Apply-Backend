import mongoose from 'mongoose';

const passkeyChallengeSchema = new mongoose.Schema(
  {
    challenge: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    type: {
      type: String,
      enum: ['registration', 'authentication'],
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  {
    timestamps: true,
    collection: 'passkey_challenges',
  }
);

const PasskeyChallenge = mongoose.model('PasskeyChallenge', passkeyChallengeSchema);

export default PasskeyChallenge;

