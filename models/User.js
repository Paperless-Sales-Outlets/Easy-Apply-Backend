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
      // Required for customers (enforced in the registration controller) but
      // not collected for staff accounts created from User Management, which
      // identify staff by employeeNumber instead. `sparse` keeps the unique
      // index from treating every phone-less staff account as a duplicate.
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    // Free-form role name. 'Customer' and 'Admin' are reserved system roles;
    // any other value is the name of a StaffRole an Admin defined and
    // maintains from User Management.
    role: {
      type: String,
      default: 'Customer',
    },
    // Unique staff identifier, collected instead of NIC/phone when an Admin
    // creates a Manager / Sales Officer / etc. account from User Management.
    employeeNumber: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    // Module keys (see admin MODULE_ACCESS) this staff account can access,
    // assigned by an Admin when the account is created or edited.
    permissions: {
      type: [String],
      default: [],
    },
    // Lets an Admin suspend a staff account without deleting it.
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    NIC: {
      // Required for customers (enforced in the registration controller) but
      // not collected for staff accounts — see employeeNumber above.
      type: String,
      unique: true,
      sparse: true,
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
    // Account-level KYC review (used when a customer has registered but has no
    // application yet). Once they apply, the application's own status takes over.
    kycStatus: { type: String, enum: ['pending', 'approved', 'rejected', 'flagged'] },
    kycNotes: { type: String, trim: true, maxlength: 2000 },
    kycActionedAt: { type: Date },
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
