import mongoose from 'mongoose';

// Roles an Admin defines and maintains from User Management. Each one is a
// named, reusable set of module privileges that can be assigned to staff
// accounts (Manager, Sales Officer, Customer Care Officer, or any custom
// role an Admin adds). 'Admin' and 'Customer' are reserved system roles and
// are never stored here.
const staffRoleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Role name is required'],
      trim: true,
      unique: true,
    },
    permissions: {
      type: [String],
      default: [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

const StaffRole = mongoose.model('StaffRole', staffRoleSchema);

export default StaffRole;
