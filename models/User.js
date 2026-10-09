import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Staff accounts: the Admin plus every employee an Admin adds from User
// Management. Stored in the `users` collection. Customers live in their own
// `customers` collection — see Customer.js.
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'Please enter a valid email address',
      ],
    },
    // Not collected for staff created from User Management, which identify
    // staff by employeeNumber instead. Kept optional because older admin
    // records carry one. `sparse` keeps the unique index from treating every
    // phone-less account as a duplicate null.
    phone: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    NIC: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      uppercase: true,
    },
    // Free-form role name. 'Admin' is the reserved system role; any other
    // value is the name of a StaffRole an Admin defined and maintains from
    // User Management.
    role: {
      type: String,
      required: [true, 'Role is required'],
    },
    // Unique staff identifier, auto-generated when an Admin creates an
    // account from User Management.
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
    password: {
      type: String,
      minlength: [6, 'Password must be at least 6 characters'],
      select: false, // Don't return password in user queries by default
    },
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

// Encrypt password using bcrypt pre-save
userSchema.pre('save', async function (next) {
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
