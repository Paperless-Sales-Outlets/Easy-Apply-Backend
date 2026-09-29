import StaffRole from '../../models/StaffRole.js';
import User from '../../models/User.js';

const RESERVED_NAMES = new Set(['admin', 'customer']);

const sanitizeRole = (r, userCount = 0) => ({
  id: r._id,
  name: r.name,
  permissions: r.permissions || [],
  userCount,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

// @desc    List all staff roles an Admin has defined, with how many users hold each
// @route   GET /api/admin/roles
// @access  Private (Admin)
export const getStaffRoles = async (req, res, next) => {
  try {
    const roles = await StaffRole.find().sort({ createdAt: 1 }).lean();
    const counts = await User.aggregate([
      { $match: { role: { $in: roles.map((r) => r.name) } } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]);
    const countByName = Object.fromEntries(counts.map((c) => [c._id, c.count]));

    res.status(200).json({
      success: true,
      roles: roles.map((r) => sanitizeRole(r, countByName[r.name] || 0)),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a new staff role (name + default module privileges)
// @route   POST /api/admin/roles
// @access  Private (Admin)
export const createStaffRole = async (req, res, next) => {
  try {
    const { name, permissions } = req.body;

    if (!name || !String(name).trim()) {
      res.status(400);
      return next(new Error('Role name is required'));
    }

    const cleanName = String(name).trim();
    if (RESERVED_NAMES.has(cleanName.toLowerCase())) {
      res.status(400);
      return next(new Error(`"${cleanName}" is a reserved role name`));
    }

    const existing = await StaffRole.findOne({ name: new RegExp(`^${cleanName}$`, 'i') });
    if (existing) {
      res.status(409);
      return next(new Error('A role with this name already exists'));
    }

    const role = await StaffRole.create({
      name: cleanName,
      permissions: Array.isArray(permissions) ? permissions : [],
      createdBy: req.user?._id,
    });

    res.status(201).json({ success: true, role: sanitizeRole(role, 0) });
  } catch (error) {
    if (error.code === 11000) {
      res.status(409);
      return next(new Error('A role with this name already exists'));
    }
    next(error);
  }
};

// @desc    Rename a role and/or change its default privileges. Renaming
//          cascades to every user currently holding the old role name.
// @route   PATCH /api/admin/roles/:id
// @access  Private (Admin)
export const updateStaffRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, permissions } = req.body;

    const role = await StaffRole.findById(id);
    if (!role) {
      res.status(404);
      return next(new Error('Role not found'));
    }

    const oldName = role.name;

    if (name !== undefined) {
      const cleanName = String(name).trim();
      if (!cleanName) {
        res.status(400);
        return next(new Error('Role name is required'));
      }
      if (RESERVED_NAMES.has(cleanName.toLowerCase())) {
        res.status(400);
        return next(new Error(`"${cleanName}" is a reserved role name`));
      }
      if (cleanName.toLowerCase() !== oldName.toLowerCase()) {
        const existing = await StaffRole.findOne({ name: new RegExp(`^${cleanName}$`, 'i'), _id: { $ne: id } });
        if (existing) {
          res.status(409);
          return next(new Error('A role with this name already exists'));
        }
      }
      role.name = cleanName;
    }

    if (Array.isArray(permissions)) role.permissions = permissions;

    await role.save();

    if (role.name !== oldName) {
      await User.updateMany({ role: oldName }, { $set: { role: role.name } });
    }

    const userCount = await User.countDocuments({ role: role.name });
    res.status(200).json({ success: true, role: sanitizeRole(role, userCount) });
  } catch (error) {
    if (error.code === 11000) {
      res.status(409);
      return next(new Error('A role with this name already exists'));
    }
    next(error);
  }
};

// @desc    Delete a role. Blocked while any user still holds it.
// @route   DELETE /api/admin/roles/:id
// @access  Private (Admin)
export const deleteStaffRole = async (req, res, next) => {
  try {
    const { id } = req.params;

    const role = await StaffRole.findById(id);
    if (!role) {
      res.status(404);
      return next(new Error('Role not found'));
    }

    const inUse = await User.countDocuments({ role: role.name });
    if (inUse > 0) {
      res.status(409);
      return next(new Error(`${inUse} user(s) still have this role — reassign them first`));
    }

    await StaffRole.deleteOne({ _id: id });
    res.status(200).json({ success: true, message: 'Role removed' });
  } catch (error) {
    next(error);
  }
};
