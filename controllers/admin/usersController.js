import User from '../../models/User.js';
import StaffRole from '../../models/StaffRole.js';

const sanitizeUser = (u) => ({
  id: u._id,
  name: u.name,
  email: u.email,
  employeeNumber: u.employeeNumber,
  role: u.role,
  permissions: u.permissions || [],
  isActive: u.isActive !== false,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

// A role name is assignable through User Management if it's either the
// reserved 'Admin' role or a role an Admin has defined in StaffRole.
async function isAssignableRole(role) {
  if (role === 'Admin') return true;
  const exists = await StaffRole.findOne({ name: new RegExp(`^${role}$`, 'i') }).select('_id');
  return !!exists;
}

// @desc    List staff/admin accounts managed through the admin User Management screen
// @route   GET /api/admin/users
// @access  Private (Admin)
export const getAdminUsers = async (req, res, next) => {
  try {
    const users = await User.find({ role: { $ne: 'Customer' } })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: users.length,
      users: users.map(sanitizeUser),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a staff account (Admin picks a role it has defined and assigns privileges)
// @route   POST /api/admin/users
// @access  Private (Admin)
export const createAdminUser = async (req, res, next) => {
  try {
    const { name, email, employeeNumber, password, role, permissions } = req.body;

    if (!name || !email || !employeeNumber || !password || !role) {
      res.status(400);
      return next(new Error('Employee number, name, email, password and role are required'));
    }

    // Admin accounts are not created from this screen.
    if (role === 'Admin' || !(await isAssignableRole(role))) {
      res.status(400);
      return next(new Error('Invalid role selected'));
    }

    if (String(password).length < 6) {
      res.status(400);
      return next(new Error('Password must be at least 6 characters'));
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanEmployeeNumber = String(employeeNumber).trim();

    const existing = await User.findOne({
      $or: [{ email: cleanEmail }, { employeeNumber: cleanEmployeeNumber }],
    }).select('_id');

    if (existing) {
      res.status(409);
      return next(new Error('A user with this email or employee number already exists'));
    }

    const user = await User.create({
      name,
      email: cleanEmail,
      employeeNumber: cleanEmployeeNumber,
      password,
      role,
      permissions: Array.isArray(permissions) ? permissions : [],
      createdBy: req.user?._id,
    });

    res.status(201).json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      res.status(409);
      return next(new Error('A user with this email or employee number already exists'));
    }
    next(error);
  }
};

// @desc    Update a managed user's profile, role, privileges, status, or password
// @route   PATCH /api/admin/users/:id
// @access  Private (Admin)
export const updateAdminUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, employeeNumber, role, permissions, isActive, password } = req.body;

    const user = await User.findById(id);
    if (!user || user.role === 'Customer') {
      res.status(404);
      return next(new Error('User not found'));
    }

    if (role !== undefined && role !== user.role) {
      // Administrator accounts are not managed through this screen — changing
      // an account to or from Admin here has previously caused an admin to
      // accidentally demote their own account. Role changes here are limited
      // to the roles this screen creates.
      if (user.role === 'Admin' || role === 'Admin') {
        res.status(400);
        return next(new Error('Administrator accounts cannot be re-assigned from User Management'));
      }
      if (!(await isAssignableRole(role))) {
        res.status(400);
        return next(new Error('Invalid role selected'));
      }
      user.role = role;
    }

    if (name) user.name = name;
    if (email !== undefined) {
      const cleanEmail = email && String(email).trim() ? String(email).trim().toLowerCase() : undefined;
      if (!cleanEmail) {
        res.status(400);
        return next(new Error('Email address is required'));
      }
      user.email = cleanEmail;
    }
    if (employeeNumber !== undefined) {
      const cleanEmployeeNumber = String(employeeNumber).trim();
      if (!cleanEmployeeNumber) {
        res.status(400);
        return next(new Error('Employee number is required'));
      }
      user.employeeNumber = cleanEmployeeNumber;
    }
    if (Array.isArray(permissions)) user.permissions = permissions;
    if (typeof isActive === 'boolean') {
      if (isActive === false && String(req.user?._id) === String(user._id)) {
        res.status(400);
        return next(new Error('You cannot deactivate your own account'));
      }
      user.isActive = isActive;
    }
    if (password) {
      if (String(password).length < 6) {
        res.status(400);
        return next(new Error('Password must be at least 6 characters'));
      }
      user.password = password;
    }

    await user.save();
    res.status(200).json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      res.status(409);
      return next(new Error('A user with this email or employee number already exists'));
    }
    next(error);
  }
};

// @desc    Remove a managed user account
// @route   DELETE /api/admin/users/:id
// @access  Private (Admin)
export const deleteAdminUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (String(req.user?._id) === String(id)) {
      res.status(400);
      return next(new Error('You cannot delete your own account'));
    }

    const user = await User.findById(id);
    if (!user || user.role === 'Customer') {
      res.status(404);
      return next(new Error('User not found'));
    }

    await User.deleteOne({ _id: id });
    res.status(200).json({ success: true, message: 'User removed' });
  } catch (error) {
    next(error);
  }
};
