import mongoose from 'mongoose';

// A privilege an Admin can attach to roles and users from User Management.
// The built-in module privileges (dashboard, kyc, ...) are seeded as
// `isSystem` — the admin sidebar gates pages on their keys, so their key can
// never change and they cannot be deleted. Admins can still reword their
// name and description, and create any number of custom privileges.
const privilegeSchema = new mongoose.Schema(
  {
    // Stable identifier stored in StaffRole.permissions / User.permissions.
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      immutable: true,
    },
    name: {
      type: String,
      required: [true, 'Privilege name is required'],
      trim: true,
      maxlength: [60, 'Name must be at most 60 characters'],
    },
    description: {
      type: String,
      required: [true, 'A description is required'],
      trim: true,
      maxlength: [300, 'Description must be at most 300 characters'],
    },
    isSystem: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

const Privilege = mongoose.model('Privilege', privilegeSchema);

export default Privilege;
