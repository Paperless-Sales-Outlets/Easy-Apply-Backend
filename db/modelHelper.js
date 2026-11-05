import { query, toCamelCase } from '../config/db.js';

// Convert camelCase string to snake_case
export function toSnakeCase(str) {
  // All-caps keys (NIC, OTP) are single words: 'NIC' must map to "nic", not "_n_i_c".
  if (/^[A-Z0-9_]+$/.test(str)) return str.toLowerCase();
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Resolves a field key into a valid PostgreSQL column or JSONB expression.
 * Examples:
 *   - '_id' => 'id'
 *   - 'salesOfficer' => 'sales_officer_id'
 *   - 'formData.nameFull' => "(form_data->>'nameFull')"
 *   - 'formData.product.name' => "(form_data->'product'->>'name')"
 *   - 'identityDocuments.nicFront' => "(identity_documents->>'nicFront')"
 */
export function formatColumnOrPath(key) {
  if (key === '_id') return 'id';
  if (key === 'salesOfficer') return 'sales_officer_id';
  if (key === 'officer') return 'officer_id';
  if (key.toLowerCase() === 'nic') return 'nic';
  if (key.toLowerCase() === 'otp') return 'otp';
  if (!key.includes('.')) {
    if (/^[A-Z0-9_]+$/.test(key)) {
      return key.toLowerCase();
    }
    return toSnakeCase(key);
  }

  const parts = key.split('.');
  const rawRoot = parts[0];
  const rootCol = /^[A-Z0-9_]+$/.test(rawRoot) ? rawRoot.toLowerCase() : toSnakeCase(rawRoot);
  if (parts.length === 2) {
    return `(${rootCol}->>'${parts[1]}')`;
  }
  const intermediate = parts.slice(1, -1).map((p) => `'${p}'`).join('->');
  const last = parts[parts.length - 1];
  return `(${rootCol}->${intermediate}->>'${last}')`;
}

/**
 * Builds a WHERE clause from a MongoDB-style filter object.
 * Supports:
 *   - Bare values: { email: 'abc' }
 *   - Case-insensitive regex: { email: new RegExp('^abc$', 'i') } or { field: { $regex: 'abc', $options: 'i' } }
 *   - Field existence: { 'identityDocuments.nicFront': { $exists: true } }
 *   - Negation: { role: { $ne: 'Customer' } }
 *   - Array inclusion: { key: { $in: ['a', 'b'] } }
 *   - Comparisons: { count: { $gt: 5 } }
 *   - Logical operators: { $or: [...], $and: [...] }
 */
export function buildWhereClause(filter = {}, startIndex = 1) {
  const clauses = [];
  const values = [];
  let paramIdx = startIndex;

  for (const [key, rawVal] of Object.entries(filter)) {
    if (rawVal === undefined) continue;

    // Handle $or condition
    if (key === '$or' && Array.isArray(rawVal)) {
      const orClauses = [];
      for (const branch of rawVal) {
        const sub = buildWhereClause(branch, paramIdx);
        if (sub.clauses.length > 0) {
          orClauses.push(`(${sub.clauses.join(' AND ')})`);
          values.push(...sub.values);
          paramIdx = sub.nextParamIndex;
        }
      }
      if (orClauses.length > 0) {
        clauses.push(`(${orClauses.join(' OR ')})`);
      }
      continue;
    }

    // Handle $and condition
    if (key === '$and' && Array.isArray(rawVal)) {
      for (const branch of rawVal) {
        const sub = buildWhereClause(branch, paramIdx);
        if (sub.clauses.length > 0) {
          clauses.push(`(${sub.clauses.join(' AND ')})`);
          values.push(...sub.values);
          paramIdx = sub.nextParamIndex;
        }
      }
      continue;
    }

    const col = formatColumnOrPath(key);

    if (rawVal === null) {
      clauses.push(`${col} IS NULL`);
      continue;
    }

    // RegExp matching (e.g. case-insensitive search)
    if (rawVal instanceof RegExp) {
      clauses.push(`${col} ~* $${paramIdx++}`);
      values.push(rawVal.source);
      continue;
    }

    // Object operator check: $exists, $regex, $ne, $in, $gt, etc.
    if (typeof rawVal === 'object' && !Array.isArray(rawVal) && !(rawVal instanceof Date)) {
      // 1. $exists
      if (rawVal.$exists !== undefined) {
        if (key.includes('.')) {
          const parts = key.split('.');
          const rootCol = toSnakeCase(parts[0]);
          if (parts.length === 2) {
            if (rawVal.$exists) {
              clauses.push(`(${rootCol} ? '${parts[1]}' AND (${rootCol}->>'${parts[1]}') IS NOT NULL)`);
            } else {
              clauses.push(`(NOT (${rootCol} ? '${parts[1]}') OR (${rootCol}->>'${parts[1]}') IS NULL)`);
            }
          } else {
            clauses.push(rawVal.$exists ? `${col} IS NOT NULL` : `${col} IS NULL`);
          }
        } else {
          clauses.push(rawVal.$exists ? `${col} IS NOT NULL` : `${col} IS NULL`);
        }
        continue;
      }

      // 2. $regex as object property
      if (rawVal.$regex !== undefined) {
        const pattern =
          typeof rawVal.$regex === 'string'
            ? rawVal.$regex
            : rawVal.$regex.source || String(rawVal.$regex);
        clauses.push(`${col} ~* $${paramIdx++}`);
        values.push(pattern);
        continue;
      }

      // 3. $ne
      if (rawVal.$ne !== undefined) {
        if (rawVal.$ne === null) {
          clauses.push(`${col} IS NOT NULL`);
        } else {
          clauses.push(`(${col} IS NULL OR ${col} != $${paramIdx++})`);
          values.push(rawVal.$ne);
        }
        continue;
      }

      // 4. $in
      if (Array.isArray(rawVal.$in)) {
        if (rawVal.$in.length === 0) {
          clauses.push('1=0');
        } else {
          clauses.push(`${col} = ANY($${paramIdx++})`);
          values.push(rawVal.$in);
        }
        continue;
      }

      // 5. $nin
      if (Array.isArray(rawVal.$nin)) {
        clauses.push(`NOT (${col} = ANY($${paramIdx++}))`);
        values.push(rawVal.$nin);
        continue;
      }

      // 6. Comparisons
      if (rawVal.$gt !== undefined) {
        clauses.push(`${col} > $${paramIdx++}`);
        values.push(rawVal.$gt);
        continue;
      }
      if (rawVal.$gte !== undefined) {
        clauses.push(`${col} >= $${paramIdx++}`);
        values.push(rawVal.$gte);
        continue;
      }
      if (rawVal.$lt !== undefined) {
        clauses.push(`${col} < $${paramIdx++}`);
        values.push(rawVal.$lt);
        continue;
      }
      if (rawVal.$lte !== undefined) {
        clauses.push(`${col} <= $${paramIdx++}`);
        values.push(rawVal.$lte);
        continue;
      }

      // Fallback equality check for plain objects
      clauses.push(`${col} = $${paramIdx++}`);
      values.push(rawVal);
      continue;
    }

    // Standard scalar equality
    clauses.push(`${col} = $${paramIdx++}`);
    values.push(rawVal);
  }

  const whereText = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { whereText, values, nextParamIndex: paramIdx, clauses };
}

/**
 * Creates a thenable QueryBuilder that behaves like Mongoose's Query:
 * supports .sort(), .limit(), .skip(), .select(), .distinct(), .lean(), and await.
 */
export function createQueryBuilder({ tableName, baseQuery, countQuery = false, filter = {}, ModelClass = null }) {
  let sortClause = '';
  let limitClause = '';
  let offsetClause = '';
  let selectedCols = '*';

  const builder = {
    sort(sortArg) {
      if (!sortArg) return builder;
      const orderParts = [];
      if (typeof sortArg === 'string') {
        const parts = sortArg.split(' ').filter(Boolean);
        for (const p of parts) {
          if (p.startsWith('-')) {
            orderParts.push(`${formatColumnOrPath(p.slice(1))} DESC`);
          } else {
            orderParts.push(`${formatColumnOrPath(p)} ASC`);
          }
        }
      } else if (typeof sortArg === 'object') {
        for (const [k, v] of Object.entries(sortArg)) {
          const dir = v === -1 || v === 'desc' ? 'DESC' : 'ASC';
          const col = formatColumnOrPath(k);
          orderParts.push(`${col} ${dir}`);
        }
      }
      if (orderParts.length > 0) {
        sortClause = `ORDER BY ${orderParts.join(', ')}`;
      }
      return builder;
    },

    limit(n) {
      if (typeof n === 'number' && n >= 0) {
        limitClause = `LIMIT ${n}`;
      }
      return builder;
    },

    skip(n) {
      if (typeof n === 'number' && n >= 0) {
        offsetClause = `OFFSET ${n}`;
      }
      return builder;
    },

    select(fields) {
      if (typeof fields === 'string') {
        const cols = fields
          .split(' ')
          .filter(Boolean)
          .filter((f) => !f.startsWith('+') && !f.startsWith('-'))
          .map((f) => {
            if (f === '_id') return 'id';
            // When querying nested JSONB fields such as 'formData.documents', select the root column 'form_data'
            if (f.includes('.')) {
              return toSnakeCase(f.split('.')[0]);
            }
            return toSnakeCase(f);
          });
        const uniqueCols = [...new Set(cols)];
        if (uniqueCols.length > 0) {
          selectedCols = uniqueCols.join(', ');
        }
      }
      return builder;
    },

    lean() {
      return builder;
    },

    populate() {
      return builder;
    },

    async distinct(field) {
      const col = field === '_id' ? 'id' : field.includes('.') ? formatColumnOrPath(field) : toSnakeCase(field);
      const { whereText, values } = buildWhereClause(filter);
      const sql = `SELECT DISTINCT ${col} as val FROM ${tableName} ${whereText ? `${whereText} AND` : 'WHERE'} ${col} IS NOT NULL`;
      const res = await query(sql, values);
      return res.rows.map((r) => r.val);
    },

    // Promise implementation
    async then(resolve, reject) {
      try {
        const { whereText, values } = buildWhereClause(filter);

        if (countQuery) {
          const sql = `SELECT COUNT(*)::int as count FROM ${tableName} ${whereText}`;
          const res = await query(sql, values);
          const count = res.rows.length ? res.rows[0].count : 0;
          return resolve(count);
        }

        const sql = `SELECT ${selectedCols} FROM ${tableName} ${whereText} ${sortClause} ${limitClause} ${offsetClause}`.trim();
        const res = await query(sql, values);

        const rows = res.rows.map((r) => {
          const item = toCamelCase(r);
          return ModelClass ? new ModelClass(item) : item;
        });

        resolve(rows);
      } catch (err) {
        reject(err);
      }
    },

    catch(reject) {
      return builder.then(null, reject);
    },
  };

  return builder;
}

/**
 * Creates a thenable QueryBuilder for single-document queries (e.g. Model.findOne).
 * Supports chaining .sort(), .select(), .lean(), .populate(), and directly awaiting.
 */
export function createFindOneQueryBuilder({ tableName, filter = {}, ModelClass = null }) {
  const builder = createQueryBuilder({
    tableName,
    filter,
    ModelClass,
  }).limit(1);

  const originalThen = builder.then.bind(builder);
  builder.then = (resolve, reject) => {
    return originalThen((rows) => {
      resolve(rows && rows.length > 0 ? rows[0] : null);
    }, reject);
  };
  return builder;
}

/**
 * Creates a thenable QueryBuilder for findById queries.
 * Supports chaining .select(), .lean(), .populate(), and directly awaiting.
 */
export function createFindByIdQueryBuilder({ tableName, id, ModelClass = null }) {
  if (!id) {
    const emptyBuilder = {
      select() { return this; },
      lean() { return this; },
      populate() { return this; },
      then(resolve) { resolve(null); },
      catch() { return this; },
    };
    return emptyBuilder;
  }
  return createFindOneQueryBuilder({
    tableName,
    filter: { _id: id },
    ModelClass,
  });
}

/**
 * Generic findOneAndUpdate helper for PostgreSQL models mimicking Mongoose.
 */
export async function genericFindOneAndUpdate(tableName, filter, update = {}, options = {}, ModelClass = null) {
  const { whereText, values } = buildWhereClause(filter);
  const findSql = `SELECT * FROM ${tableName} ${whereText} LIMIT 1`;
  const findRes = await query(findSql, values);

  if (findRes.rows.length === 0) {
    if (!options.upsert) {
      return null;
    }
    // Upsert new row
    const insertData = { ...filter, ...(update.$setOnInsert || {}), ...(update.$set || {}) };
    for (const [k, v] of Object.entries(update)) {
      if (!k.startsWith('$')) insertData[k] = v;
    }
    delete insertData._id;
    delete insertData.id;

    const cols = [];
    const valPlaceholders = [];
    const valArr = [];
    let idx = 1;

    for (const [k, v] of Object.entries(insertData)) {
      const colName = toSnakeCase(k);
      cols.push(colName);
      valPlaceholders.push(`$${idx++}`);
      valArr.push(typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v);
    }

    const insertSql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${valPlaceholders.join(', ')}) RETURNING *`;
    const insertRes = await query(insertSql, valArr);
    const item = toCamelCase(insertRes.rows[0]);
    return ModelClass ? new ModelClass(item) : item;
  }

  // Update existing row
  const rowId = findRes.rows[0].id;
  const currentRecord = toCamelCase(findRes.rows[0]);

  if (update.$set) {
    Object.assign(currentRecord, update.$set);
  }
  if (update.$push) {
    for (const [arrKey, item] of Object.entries(update.$push)) {
      const existingArr = Array.isArray(currentRecord[arrKey]) ? currentRecord[arrKey] : [];
      if (item && item.$each && Array.isArray(item.$each)) {
        currentRecord[arrKey] = [...existingArr, ...item.$each];
      } else {
        currentRecord[arrKey] = [...existingArr, item];
      }
    }
  }
  for (const [k, v] of Object.entries(update)) {
    if (!k.startsWith('$')) {
      currentRecord[k] = v;
    }
  }

  // If ModelClass has its own save() method, use it for customized column mapping
  if (ModelClass) {
    const instance = new ModelClass(currentRecord);
    if (typeof instance.save === 'function') {
      return await instance.save();
    }
  }

  // Generic column update
  const setClauses = [];
  const updateValues = [];
  let updateIdx = 1;

  for (const [k, v] of Object.entries(currentRecord)) {
    if (k === 'id' || k === 'createdAt') continue;
    const colName = toSnakeCase(k);
    setClauses.push(`${colName} = $${updateIdx++}`);
    updateValues.push(typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v);
  }

  setClauses.push(`updated_at = NOW()`);
  updateValues.push(rowId);

  const updateSql = `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = $${updateIdx} RETURNING *`;
  const updateRes = await query(updateSql, updateValues);
  const updatedItem = toCamelCase(updateRes.rows[0]);
  return ModelClass ? new ModelClass(updatedItem) : updatedItem;
}
