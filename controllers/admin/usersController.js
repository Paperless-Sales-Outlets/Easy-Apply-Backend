import User from '../../models/User.js';

// Roles an Admin can create/manage from the User Management screen.
// Customers are excluded — they self-register through the public app.
export const MANAGEABLE_ROLES = ['Admin', 'Manager', 'SalesOfficer', 'CustomerCareOfficer'];

const sanitizeUser = (u) => ({
  id: u._id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  NIC: u.NIC,
  role: u.role,
  permissions: u.permissions || [],
  isActive: u.isActive !== false,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

// @desc    List staff/admin accounts managed through the admin User Management screen
// @route   GET /api/admin/users
// @access  Private (Admin)
export const getAdminUsers = async (req, res, next) => {
  try {
    const users = await User.find({ role: { $in: MANAGEABLE_ROLES } })
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

// @desc    Create a Manager / Sales Officer / Customer Care Officer / Admin account
// @route   POST /api/admin/users
// @access  Private (Admin)
export const createAdminUser = async (req, res, next) => {
  try {
    const { name, email, phone, NIC, password, role, permissions } = req.body;

    if (!name || !phone || !NIC || !password || !role) {
      res.status(400);
      return next(new Error('Name, phone, NIC, password and role are required'));
    }

    if (!MANAGEABLE_ROLES.includes(role)) {
      res.status(400);
      return next(new Error('Invalid role selected'));
    }

    if (String(password).length < 6) {
      res.status(400);
      return next(new Error('Password must be at least 6 characters'));
    }

    const cleanEmail = email && String(email).trim() ? String(email).trim().toLowerCase() : undefined;
    const cleanNic = String(NIC).trim().toUpperCase();
    const digitsOnly = String(phone).replace(/\D/g, '');

    const existing = await User.findOne({
      $or: [
        ...(cleanEmail ? [{ email: cleanEmail }] : []),
        { phone: digitsOnly },
        { NIC: cleanNic },
      ],
    }).select('_id');

    if (existing) {
      res.status(409);
      return next(new Error('A user with this email, phone number, or NIC already exists'));
    }

    const user = await User.create({
      name,
      ...(cleanEmail ? { email: cleanEmail } : {}),
      phone: digitsOnly,
      NIC: cleanNic,
      password,
      role,
      permissions: Array.isArray(permissions) ? permissions : [],
      createdBy: req.user?._id,
    });

    res.status(201).json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      res.status(409);
      return next(new Error('A user with this email, phone number, or NIC already exists'));
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
    const { name, email, phone, NIC, role, permissions, isActive, password } = req.body;

    const user = await User.findById(id);
    if (!user || !MANAGEABLE_ROLES.includes(user.role)) {
      res.status(404);
      return next(new Error('User not found'));
    }

    if (role !== undefined && role !== user.role) {
      if (!MANAGEABLE_ROLES.includes(role)) {
        res.status(400);
        return next(new Error('Invalid role selected'));
      }
      // Administrator accounts are not managed through this screen — changing
      // an account to or from Admin here has previously caused an admin to
      // accidentally demote their own account. Role changes here are limited
      // to the roles this screen creates.
      if (user.role === 'Admin' || role === 'Admin') {
        res.status(400);
        return next(new Error('Administrator accounts cannot be re-assigned from User Management'));
      }
      user.role = role;
    }

    if (name) user.name = name;
    if (email !== undefined) {
      user.email = email && String(email).trim() ? String(email).trim().toLowerCase() : undefined;
    }
    if (phone) user.phone = String(phone).replace(/\D/g, '');
    if (NIC) user.NIC = String(NIC).trim().toUpperCase();
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
      return next(new Error('A user with this email, phone number, or NIC already exists'));
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
    if (!user || !MANAGEABLE_ROLES.includes(user.role)) {
      res.status(404);
      return next(new Error('User not found'));
    }

    await User.deleteOne({ _id: id });
    res.status(200).json({ success: true, message: 'User removed' });
  } catch (error) {
    next(error);
  }
};
