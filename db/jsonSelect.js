// SQL for reading a few keys out of a large JSONB column.
//
// Customer images are stored as base64 text inside the JSON columns (up to
// several MB a row). A separate column->'key' for every field makes Postgres
// unpack the whole value again each time, so these walk the column once.

/** Cuts an inline image down to its "data:image/..." prefix, leaves anything else as it is. */
export const trimInline = (v) =>
  `CASE WHEN jsonb_typeof(${v}) = 'string' AND left(${v} #>> '{}', 5) = 'data:' THEN to_jsonb(left(${v} #>> '{}', 32)) ELSE ${v} END`;

/** A JSON object holding only `keys` of `json` (every key when null). `alias` must be unique within the query. */
export const pickFrom = (json, keys, alias, valueOf = trimInline) => `COALESCE((
  SELECT jsonb_object_agg(${alias}.k, ${valueOf(`${alias}.v`)})
  FROM jsonb_each(CASE WHEN jsonb_typeof(${json}) = 'object' THEN ${json} END) AS ${alias}(k, v)
  ${keys ? `WHERE ${alias}.k = ANY(ARRAY[${keys.map((key) => `'${key}'`).join(', ')}])` : ''}
), '{}'::jsonb)`;
