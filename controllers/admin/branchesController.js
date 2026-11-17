import { query } from '../../config/db.js';
import { recordAudit } from '../../services/auditService.js';

// The branch hierarchy: Region → Province → RTO → Teleshop. Each level below
// Region belongs to one entry of the level above it.
export const BRANCH_LEVELS = {
  regions: { table: 'regions', label: 'Region', parent: null, child: 'provinces' },
  provinces: { table: 'provinces', label: 'Province', parent: { level: 'regions', column: 'region_id', key: 'regionId' }, child: 'rtos' },
  rtos: { table: 'rtos', label: 'RTO', parent: { level: 'provinces', column: 'province_id', key: 'provinceId' }, child: 'teleshops' },
  teleshops: { table: 'teleshops', label: 'Teleshop', parent: { level: 'rtos', column: 'rto_id', key: 'rtoId' }, child: null },
};

const NAME_MIN = 2;
const NAME_MAX = 100;
// 'region', 'province', 'teleshop' in a sentence — but 'RTO' stays in capitals.
const noun = (label) => (label === 'RTO' ? label : label.toLowerCase());
const plural = (label) => `${noun(label)}s`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toItem = (level, row) => {
  const { parent } = BRANCH_LEVELS[level];
  return {
    id: row.id,
    name: row.name,
    ...(parent ? { [parent.key]: row[parent.column] } : {}),
    childCount: Number(row.child_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// One level's rows, each with how many entries sit directly under it.
async function listLevel(level) {
  const { table, parent, child } = BRANCH_LEVELS[level];
  const childCount = child
    ? `(SELECT COUNT(*) FROM ${BRANCH_LEVELS[child].table} c WHERE c.${BRANCH_LEVELS[child].parent.column} = t.id)`
    : '0';
  const { rows } = await query(
    `SELECT t.id, t.name, ${parent ? `t.${parent.column},` : ''} t.created_at, t.updated_at, ${childCount} AS child_count
     FROM ${table} t ORDER BY LOWER(t.name)`
  );
  return rows.map((row) => toItem(level, row));
}

async function findOne(level, id) {
  if (!UUID.test(String(id || ''))) return null;
  const { table } = BRANCH_LEVELS[level];
  const { rows } = await query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  return rows[0] || null;
}

// Checks the name and (below Region) the parent; returns the clean values or an error.
async function validateInput(level, body, currentId = null) {
  const { table, label, parent } = BRANCH_LEVELS[level];
  const name = String(body?.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { error: `${label} name is required`, status: 400 };
  if (name.length < NAME_MIN) return { error: `${label} name must be at least ${NAME_MIN} characters`, status: 400 };
  if (name.length > NAME_MAX) return { error: `${label} name must be at most ${NAME_MAX} characters`, status: 400 };

  const { rows: clash } = await query(
    `SELECT id FROM ${table} WHERE LOWER(name) = LOWER($1) ${currentId ? 'AND id <> $2' : ''} LIMIT 1`,
    currentId ? [name, currentId] : [name]
  );
  if (clash.length) return { error: `${label === 'RTO' ? 'An' : 'A'} ${noun(label)} named "${name}" already exists`, status: 409 };

  let parentId = null;
  if (parent) {
    parentId = body?.parentId ?? body?.[parent.key];
    const parentLabel = BRANCH_LEVELS[parent.level].label;
    if (!parentId) return { error: `Select the ${noun(parentLabel)} this ${noun(label)} belongs to`, status: 400 };
    if (!(await findOne(parent.level, parentId))) return { error: `The selected ${noun(parentLabel)} no longer exists`, status: 400 };
  }
  return { name, parentId };
}

// @desc    Every region, province, RTO and teleshop, with how many entries each holds
// @route   GET /api/admin/branches
// @access  Private (Admin)
export const getBranches = async (req, res, next) => {
  try {
    const [regions, provinces, rtos, teleshops] = await Promise.all(
      Object.keys(BRANCH_LEVELS).map((level) => listLevel(level))
    );
    res.status(200).json({ success: true, regions, provinces, rtos, teleshops });
  } catch (error) {
    next(error);
  }
};

// @desc    Add a region / province / RTO / teleshop
// @route   POST /api/admin/branches/:level
// @access  Private (Admin)
export const createBranch = async (req, res, next) => {
  try {
    const { level } = req.params;
    const { table, label, parent } = BRANCH_LEVELS[level];
    const input = await validateInput(level, req.body);
    if (input.error) {
      res.status(input.status);
      return next(new Error(input.error));
    }

    const columns = ['name', 'created_by', ...(parent ? [parent.column] : [])];
    const values = [input.name, req.user?._id || null, ...(parent ? [input.parentId] : [])];
    const { rows } = await query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      values
    );

    await recordAudit({ req, action: 'CREATE', module: 'Branches', targetId: rows[0].id, description: `Added ${label} ${input.name}` });
    res.status(201).json({ success: true, item: toItem(level, rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      res.status(409);
      return next(new Error('An entry with this name already exists'));
    }
    next(error);
  }
};

// @desc    Rename an entry or move it under a different parent
// @route   PATCH /api/admin/branches/:level/:id
// @access  Private (Admin)
export const updateBranch = async (req, res, next) => {
  try {
    const { level, id } = req.params;
    const { table, label, parent } = BRANCH_LEVELS[level];
    const existing = await findOne(level, id);
    if (!existing) {
      res.status(404);
      return next(new Error(`${label} not found`));
    }

    const input = await validateInput(level, req.body, id);
    if (input.error) {
      res.status(input.status);
      return next(new Error(input.error));
    }

    const { rows } = await query(
      `UPDATE ${table} SET name = $1, ${parent ? `${parent.column} = $3,` : ''} updated_at = NOW() WHERE id = $2 RETURNING *`,
      parent ? [input.name, id, input.parentId] : [input.name, id]
    );

    const changes = [];
    if (existing.name !== input.name) changes.push(`renamed from ${existing.name}`);
    if (parent && existing[parent.column] !== input.parentId) changes.push(`moved to a different ${noun(BRANCH_LEVELS[parent.level].label)}`);
    await recordAudit({
      req,
      action: 'UPDATE',
      module: 'Branches',
      targetId: id,
      description: `Updated ${label} ${input.name}${changes.length ? ` (${changes.join(', ')})` : ''}`,
      metadata: { before: { name: existing.name, ...(parent ? { parentId: existing[parent.column] } : {}) }, after: { name: input.name, ...(parent ? { parentId: input.parentId } : {}) } },
    });
    res.status(200).json({ success: true, item: toItem(level, rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      res.status(409);
      return next(new Error('An entry with this name already exists'));
    }
    next(error);
  }
};

// @desc    Delete an entry that has nothing under it
// @route   DELETE /api/admin/branches/:level/:id
// @access  Private (Admin)
export const deleteBranch = async (req, res, next) => {
  try {
    const { level, id } = req.params;
    const { table, label, child } = BRANCH_LEVELS[level];
    const existing = await findOne(level, id);
    if (!existing) {
      res.status(404);
      return next(new Error(`${label} not found`));
    }

    if (child) {
      const childLevel = BRANCH_LEVELS[child];
      const { rows } = await query(`SELECT COUNT(*)::int AS n FROM ${childLevel.table} WHERE ${childLevel.parent.column} = $1`, [id]);
      if (rows[0].n > 0) {
        res.status(409);
        return next(new Error(`${existing.name} still has ${rows[0].n} ${rows[0].n === 1 ? noun(childLevel.label) : plural(childLevel.label)} under it. Move or delete ${rows[0].n === 1 ? 'it' : 'them'} first.`));
      }
    }

    await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    await recordAudit({ req, action: 'DELETE', module: 'Branches', targetId: id, description: `Deleted ${label} ${existing.name}` });
    res.status(200).json({ success: true, message: `${label} deleted` });
  } catch (error) {
    if (error.code === '23503') {
      res.status(409);
      return next(new Error('This entry still has entries under it. Move or delete them first.'));
    }
    next(error);
  }
};
