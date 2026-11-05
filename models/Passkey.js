// WebAuthn credentials registered by admin/staff users (PostgreSQL `passkeys` table).
// Keeps the small Mongoose-style surface passkeyController relies on:
//   find(filter).select().sort(), findOne(filter).populate('userId'), create(), deleteOne(), doc.save().
import { query, toCamelCase } from '../config/db.js';
import User from './User.js';

// The public key is stored as base64 text: the row converter would mangle a binary column.
const toDoc = (row) => {
  if (!row) return null;
  const doc = toCamelCase(row);
  doc.credentialPublicKey = Buffer.from(row.credential_public_key, 'base64');
  doc.transports = row.transports || [];
  // Persist the fields that change after sign-in (signature counter, last use).
  doc.save = async function save() {
    await query(
      'UPDATE passkeys SET counter = $1, last_used_at = $2, updated_at = NOW() WHERE id = $3',
      [this.counter, this.lastUsedAt || null, this._id]
    );
    return this;
  };
  return doc;
};

/** Builds WHERE text for the few filters the controller uses. */
function where(filter = {}) {
  const clauses = [];
  const values = [];
  const add = (column, value) => {
    values.push(value);
    clauses.push(`${column} = $${values.length}`);
  };
  if (filter._id) add('id', filter._id);
  if (filter.userId) add('user_id', filter.userId);
  if (filter.credentialID) add('credential_id', filter.credentialID);
  return { text: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

const pick = (doc, fields) =>
  fields ? Object.fromEntries(fields.filter((f) => f in doc).map((f) => [f, doc[f]])) : doc;

const Passkey = {
  /** Thenable query supporting .select('a b c') and .sort({ createdAt: -1 }). */
  find(filter = {}) {
    let fields = null;
    let order = 'created_at DESC';
    const builder = {
      select(spec) {
        fields = String(spec).split(/\s+/).filter(Boolean);
        return builder;
      },
      sort(spec) {
        const [key, dir] = Object.entries(spec || {})[0] || [];
        if (key === 'createdAt') order = `created_at ${dir === 1 ? 'ASC' : 'DESC'}`;
        return builder;
      },
      then(resolve, reject) {
        const { text, values } = where(filter);
        return query(`SELECT * FROM passkeys ${text} ORDER BY ${order}`, values)
          .then((res) => res.rows.map((row) => pick(toDoc(row), fields)))
          .then(resolve, reject);
      },
    };
    return builder;
  },

  /** Thenable query; .populate('userId') replaces userId with the full user record. */
  findOne(filter = {}) {
    let populateUser = false;
    const builder = {
      populate() {
        populateUser = true;
        return builder;
      },
      then(resolve, reject) {
        const { text, values } = where(filter);
        return (async () => {
          const res = await query(`SELECT * FROM passkeys ${text} LIMIT 1`, values);
          const doc = toDoc(res.rows[0]);
          if (doc && populateUser) doc.userId = await User.findById(doc.userId);
          return doc;
        })().then(resolve, reject);
      },
    };
    return builder;
  },

  async create(data) {
    const res = await query(
      `INSERT INTO passkeys
         (user_id, credential_id, credential_public_key, counter, device_type, backed_up, transports, device_name, last_used_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        data.userId,
        data.credentialID,
        Buffer.from(data.credentialPublicKey).toString('base64'),
        data.counter ?? 0,
        data.deviceType || 'singleDevice',
        Boolean(data.backedUp),
        data.transports || [],
        data.deviceName || 'Passkey Device',
        data.lastUsedAt || null,
      ]
    );
    return toDoc(res.rows[0]);
  },

  async deleteOne(filter = {}) {
    const { text, values } = where(filter);
    if (!text) throw new Error('Passkey.deleteOne requires a filter');
    await query(`DELETE FROM passkeys ${text}`, values);
  },
};

export default Passkey;
