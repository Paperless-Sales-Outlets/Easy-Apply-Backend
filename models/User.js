import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      // Optional: registration no longer collects an email address, so an
      // account may exist without one. `sparse` keeps the unique index from
      // treating every address-less account as a duplicate null.
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'Please enter a valid email address',
      ],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      unique: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ['Customer', 'Staff', 'Admin'],
      default: 'Customer',
    },
    NIC: {
      type: String,
      required: [true, 'NIC / Passport / BR Number is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    title: { type: String, default: 'Mr.' },
    dob: { type: String },
    gender: { type: String, default: 'Male' },
    nationality: { type: String, default: 'Sri Lankan' },
    contactNumber: { type: String },
    addressLine1: { type: String },
    addressLine2: { type: String },
    city: { type: String },
    district: { type: String },
    postalCode: { type: String },
    preferredContact: { type: String, default: 'SMS' },
    // KYC images captured at registration. Only GridFS file ids are stored —
    // keeping base64 on the user document would bloat every record and risk
    // the 16MB document ceiling.
    identityDocuments: {
      nicFront: { type: mongoose.Schema.Types.ObjectId },
      nicBack: { type: mongoose.Schema.Types.ObjectId },
      facePhoto: { type: mongoose.Schema.Types.ObjectId },
      capturedAt: { type: Date },
    },
    // Sign-in is by mobile number and one-time code, so accounts are created
    // without a password. The field is kept so existing records stay valid and
    // a password-based flow could be reintroduced later.
    password: {
      type: String,
      minlength: [6, 'Password must be at least 6 characters'],
      select: false, // Don't return password in user queries by default
    },
  },
  {
    timestamps: true,
  }
);

// Encrypt password using bcrypt pre-save
userSchema.pre('save', async function (next) {
  // Accounts created through the OTP flow have no password at all, and the
  // original guard fell through to hashing even when nothing had changed.
  if (!this.password || !this.isModified('password')) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  return next();
});

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
  // No password set means password sign-in is not available for this account.
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);

export default User;
