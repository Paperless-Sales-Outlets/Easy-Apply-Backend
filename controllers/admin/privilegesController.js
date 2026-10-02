import Privilege from '../../models/Privilege.js';
import StaffRole from '../../models/StaffRole.js';
import User from '../../models/User.js';

// Built-in module privileges. Their keys match the admin sidebar modules.
const SYSTEM_PRIVILEGES = [
  { key: 'dashboard', name: 'Dashboard', description: "View the operations dashboard: today's submissions, charts and the pending application history." },
  { key: 'kyc', name: 'KYC Review', description: 'Open the KYC queue and approve, reject or flag customer identity verifications.' },
  { key: 'appointments', name: 'Appointments', description: 'Schedule installation appointments and assign technicians to them.' },
  { key: 'technician', name: 'My Jobs', description: 'See the field jobs assigned to this person and update their progress.' },
  { key: 'forms', name: 'Forms', description: 'Browse submitted service forms and add internal comments.' },
  { key: 'analytics', name: 'Reports & Analytics', description: 'View performance reports and export analytics for applications and staff.' },
];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameRegex = (name) => new RegExp(`^${escapeRegex(name)}$`, 'i');

const sanitizePrivilege = (p, usage = { roles: 0, users: 0 }) => ({
  id: p._id,
  key: p.key,
  name: p.name,
  description: p.description,
  isSystem: !!p.isSystem,
  roleCount: usage.roles,
  userCount: usage.users,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

// Insert any built-in privilege that is missing. Existing ones (possibly
// reworded by an admin) are left untouched.
async function ensureSystemPrivileges() {
  const existing = await Privilege.find({ key: { $in: SYSTEM_PRIVILEGES.map((p) => p.key) } }).select('key').lean();
  const have = new Set(existing.map((p) => p.key));
  const missing = SYSTEM_PRIVILEGES.filter((p) => !have.has(p.key));
  if (missing.length) {
    await Privilege.insertMany(missing.map((p) => ({ ...p, isSystem: true })), { ordered: false }).catch(() => {});
  }
}

async function usageFor(key) {
  const [roles, users] = await Promise.all([
    StaffRole.countDocuments({ permissions: key }),
    User.countDocuments({ permissions: key }),
  ]);
  return { roles, users };
}

const slugify = (name) =>
  String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const validationMessage = (error) => Object.values(error.errors)[0].message;

// @desc    List all privileges with how many roles / users hold each
// @route   GET /api/admin/privileges
// @access  Private (Admin)
export const getPrivileges = async (req, res, next) => {
  try {
    await ensureSystemPrivileges();
    const privileges = await Privilege.find().sort({ isSystem: -1, createdAt: 1 }).lean();

    const [roles, users] = await Promise.all([
      StaffRole.find().select('permissions').lean(),
      User.find().select('permissions').lean(),
    ]);
    const tally = (docs) => {
      const map = {};
      docs.forEach((d) => (d.permissions || []).forEach((k) => { map[k] = (map[k] || 0) + 1; }));
      return map;
    };
    const roleCounts = tally(roles);
    const userCounts = tally(users);

    res.status(200).json({
      success: true,
      privileges: privileges.map((p) =>
        sanitizePrivilege(p, { roles: roleCounts[p.key] || 0, users: userCounts[p.key] || 0 })
      ),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a custom privilege
// @route   POST /api/admin/privileges
// @access  Private (Admin)
export const createPrivilege = async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();

    if (!name) {
      res.status(400);
      return next(new Error('Privilege name is required'));
    }
    if (!description) {
      res.status(400);
      return next(new Error('Describe what this privilege allows'));
    }

    if (await Privilege.findOne({ name: nameRegex(name) })) {
      res.status(409);
      return next(new Error('A privilege with this name already exists'));
    }

    const base = slugify(name) || 'privilege';
    let key = base;
    for (let i = 2; await Privilege.exists({ key }); i += 1) key = `${base}-${i}`;

    const privilege = await Privilege.create({ key, name, description, createdBy: req.user?._id });
    res.status(201).json({ success: true, privilege: sanitizePrivilege(privilege) });
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400);
      return next(new Error(validationMessage(error)));
    }
    next(error);
  }
};

// @desc    Update a privilege's name / description (its key never changes)
// @route   PATCH /api/admin/privileges/:id
// @access  Private (Admin)
export const updatePrivilege = async (req, res, next) => {
  try {
    const privilege = await Privilege.findById(req.params.id);
    if (!privilege) {
      res.status(404);
      return next(new Error('Privilege not found'));
    }

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) {
        res.status(400);
        return next(new Error('Privilege name is required'));
      }
      if (await Privilege.findOne({ _id: { $ne: privilege._id }, name: nameRegex(name) })) {
        res.status(409);
        return next(new Error('A privilege with this name already exists'));
      }
      privilege.name = name;
    }
    if (req.body.description !== undefined) {
      const description = String(req.body.description).trim();
      if (!description) {
        res.status(400);
        return next(new Error('Describe what this privilege allows'));
      }
      privilege.description = description;
    }

    await privilege.save();
    res.status(200).json({ success: true, privilege: sanitizePrivilege(privilege, await usageFor(privilege.key)) });
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400);
      return next(new Error(validationMessage(error)));
    }
    next(error);
  }
};

// @desc    Delete a custom privilege. Built-in ones, and any still assigned to a
//          role or user, are protected.
// @route   DELETE /api/admin/privileges/:id
// @access  Private (Admin)
export const deletePrivilege = async (req, res, next) => {
  try {
    const privilege = await Privilege.findById(req.params.id);
    if (!privilege) {
      res.status(404);
      return next(new Error('Privilege not found'));
    }
    if (privilege.isSystem) {
      res.status(400);
      return next(new Error('Built-in privileges control admin pages and cannot be deleted'));
    }

    const usage = await usageFor(privilege.key);
    if (usage.roles > 0 || usage.users > 0) {
      res.status(409);
      return next(new Error(`Still assigned to ${usage.roles} role(s) and ${usage.users} user(s) — remove it from them first`));
    }

    await Privilege.deleteOne({ _id: privilege._id });
    res.status(200).json({ success: true, message: 'Privilege removed' });
  } catch (error) {
    next(error);
  }
};
