// A custom-format dump made with `pg_dump --schema=public` still lists the
// schema itself and any extension / schema comments. Restoring those breaks:
//   - into a fresh database: CREATE SCHEMA public  -> "already exists"
//   - into the live database with --clean: DROP SCHEMA public -> "other objects
//     depend on it" (extensions, the backup-history tables, ...)
// On Supabase, extensions and the public schema are also owned by the platform.
//
// So a restore is run with `pg_restore --use-list=<filtered TOC>`: the same table
// of contents with those entries commented out. Tables, data, sequences, indexes
// and constraints are restored as before; extensions are left as the target
// database has them.

const SKIPPED_ENTRY = [
  /^\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+public\b/, // the public schema itself
  /^\d+;\s+\d+\s+\d+\s+EXTENSION\s+-\s/, // CREATE EXTENSION ...
  /^\d+;\s+\d+\s+\d+\s+COMMENT\s+-\s+EXTENSION\s/, // COMMENT ON EXTENSION ...
  /^\d+;\s+\d+\s+\d+\s+COMMENT\s+-\s+SCHEMA\s+public\b/, // COMMENT ON SCHEMA public
  // Platform-owned, database-wide objects that older dumps may still list.
  /^\d+;\s+\d+\s+\d+\s+(?:PUBLICATION|PUBLICATION TABLE|PUBLICATION TABLES IN SCHEMA|SUBSCRIPTION|EVENT TRIGGER|SECURITY LABEL)\s/,
];

/**
 * @param {string} toc output of `pg_restore --list`
 * @returns {{ text: string, skipped: string[] }} the filtered list and the entries left out
 */
export function buildRestoreList(toc) {
  const skipped = [];
  const lines = String(toc)
    .split(/\r?\n/)
    .map((line) => {
      if (line.startsWith(';') || !line.trim()) return line;
      if (SKIPPED_ENTRY.some((pattern) => pattern.test(line))) {
        skipped.push(line);
        return `;${line}`;
      }
      return line;
    });
  return { text: `${lines.join('\n').replace(/\n+$/, '')}\n`, skipped };
}

// Extensions whose functions or operator classes table definitions can reference
// in a dump. Used to create the same extension, in the same schema, in the
// temporary test-restore database before the restore.
const EXTENSION_HINTS = [
  { extension: 'uuid-ossp', pattern: /\b([A-Za-z_][\w]*)\.uuid_generate_v\d\w*\(/g },
  { extension: 'pgcrypto', pattern: /\b([A-Za-z_][\w]*)\.(?:gen_random_bytes|gen_salt|crypt|digest|hmac|pgp_\w+)\(/g },
  { extension: 'pg_trgm', pattern: /\b([A-Za-z_][\w]*)\.(?:gin_trgm_ops|gist_trgm_ops|similarity|show_trgm)\b/g },
  { extension: 'citext', pattern: /\b([A-Za-z_][\w]*)\.citext\b/g },
  { extension: 'hstore', pattern: /\b([A-Za-z_][\w]*)\.hstore\b/g },
];

/**
 * Looks through the dump's schema SQL (`pg_restore --schema-only -f -`) for
 * references to well-known extensions and returns [{ extension, schema }].
 */
export function detectExtensions(schemaSql) {
  const found = new Map();
  for (const { extension, pattern } of EXTENSION_HINTS) {
    for (const match of String(schemaSql).matchAll(pattern)) {
      if (match[1] && !found.has(extension)) found.set(extension, match[1]);
    }
  }
  return [...found].map(([extension, schema]) => ({ extension, schema }));
}
