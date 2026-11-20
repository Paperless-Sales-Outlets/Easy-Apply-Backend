import { spawn } from 'node:child_process';
import path from 'node:path';
import { getConfig, getDbConnection, pgEnv, EXCLUDED_TABLES } from './config.js';
import { BackupError, redact } from './errors.js';

// -----------------------------------------------------------------------------
// Thin wrappers around pg_dump / pg_restore / tar. Everything is spawned
// WITHOUT a shell, the database password travels only in PGPASSWORD (never on
// the command line), and all captured output is redacted before it can be
// logged or shown. Tests replace `commands.*` with fakes.
// -----------------------------------------------------------------------------

// GNU tar on Windows treats a backslash as an escape (a folder called "tmp" becomes TAB + "mp"), so directory
// arguments are passed with forward slashes, which every Windows API accepts.
const toPosix = (p) => (process.platform === 'win32' ? String(p).split(path.sep).join('/') : p);

const TAIL_BYTES = 8 * 1024;

function run(command, args, { env = process.env, cwd, timeoutMs, lowPriority = false } = {}) {
  const config = getConfig();
  const finalCommand = lowPriority ? 'nice' : command;
  const finalArgs = lowPriority ? ['-n', '10', command, ...args] : args;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(finalCommand, finalArgs, { env, cwd, shell: false, windowsHide: true });
    } catch (error) {
      reject(toolError(command, error));
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs || config.commandTimeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-TAIL_BYTES * 64);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-TAIL_BYTES);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(toolError(command, error));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new BackupError(`${label(command)} took too long and was stopped.`, 500, 'COMMAND_TIMEOUT'));
      } else {
        resolve({ code, stdout, stderr: redact(stderr) });
      }
    });
  });
}

const label = (command) => String(command).split(/[\\/]/).pop();

function toolError(command, error) {
  if (error?.code === 'ENOENT') {
    return new BackupError(
      `"${label(command)}" was not found on the server. Install the PostgreSQL client tools or set the tool path in the environment (see docs/BACKUP_AND_RESTORE.md).`,
      503,
      'TOOL_MISSING'
    );
  }
  return new BackupError(`Could not start ${label(command)}.`, 500, 'COMMAND_FAILED');
}

async function runOrThrow(command, args, options, failureMessage) {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    // Full (redacted) detail goes to the server log; the UI gets the summary.
    console.error(`[backup] ${label(command)} exited with ${result.code}: ${result.stderr.trim().slice(-1500)}`);
    const error = new BackupError(failureMessage, 500, 'COMMAND_FAILED');
    error.detail = result.stderr.trim().slice(-1500);
    throw error;
  }
  return result;
}

export const commands = {
  /** Custom-format, compressed dump of the public schema, without the backup-history tables. */
  async pgDump(outFile) {
    const config = getConfig();
    const connection = getDbConnection();
    const args = [
      '--format=custom',
      '--compress=6',
      '--schema=public',
      '--no-owner',
      '--no-acl',
      // Platform-owned objects (e.g. Supabase's supabase_realtime publication) are not ours to drop or recreate.
      '--no-publications',
      '--no-subscriptions',
      '--no-security-labels',
      ...EXCLUDED_TABLES.map((table) => `--exclude-table=public.${table}`),
      `--file=${outFile}`,
    ];
    await runOrThrow(
      config.pgDump,
      args,
      { env: pgEnv(connection), lowPriority: config.lowPriority },
      'The database dump failed. See the server log for details.'
    );
  },

  /** `pg_restore --list`: returns the table of contents, throws if the archive is unreadable. */
  async pgRestoreList(file) {
    const config = getConfig();
    const { stdout } = await runOrThrow(
      config.pgRestore,
      ['--list', file],
      { env: process.env },
      'pg_restore could not read the database archive.'
    );
    return stdout;
  },

  /** The archive's schema as SQL text (used only to spot which extensions its tables rely on). */
  async pgRestoreSchemaSql(file) {
    const config = getConfig();
    const { stdout } = await runOrThrow(
      config.pgRestore,
      ['--schema-only', '--no-owner', '--no-acl', '-f', '-', file],
      { env: process.env },
      'pg_restore could not read the database archive.'
    );
    return stdout;
  },

  /** Restores an archive into `database`. `replace` drops existing objects first, inside one transaction. */
  async pgRestore(file, database, { replace = false, listFile = null, connection = getDbConnection() } = {}) {
    const config = getConfig();
    const args = [
      '--no-owner',
      '--no-acl',
      '--exit-on-error',
      ...(listFile ? [`--use-list=${listFile}`] : []),
      ...(replace ? ['--clean', '--if-exists', '--single-transaction'] : []),
      `--dbname=${database}`,
      file,
    ];
    await runOrThrow(
      config.pgRestore,
      args,
      { env: pgEnv(connection, database), lowPriority: config.lowPriority },
      'The database restore failed. See the server log for details.'
    );
  },

  // The archive is given as a bare file name with cwd set to its folder: GNU tar reads
  // "C:..." as a remote host:path, so a drive letter must never appear in that argument.
  async tarCreate(archive, sourceDir, { gzip = false } = {}) {
    const config = getConfig();
    await runOrThrow(
      config.tar,
      [gzip ? '-czf' : '-cf', path.basename(archive), '-C', toPosix(sourceDir), '.'],
      { cwd: path.dirname(archive), lowPriority: config.lowPriority },
      'Could not archive the files.'
    );
  },

  async tarExtract(archive, destDir) {
    const config = getConfig();
    await runOrThrow(
      config.tar,
      ['-xf', path.basename(archive), '-C', toPosix(destDir)],
      { cwd: path.dirname(archive) },
      'Could not unpack the backup.'
    );
  },

  /** First line of `tool --version`, or null when the tool is missing. */
  async toolVersion(command) {
    try {
      const { code, stdout } = await run(command, ['--version'], { timeoutMs: 10000 });
      return code === 0 ? stdout.split(/\r?\n/)[0].trim() : null;
    } catch {
      return null;
    }
  },
};
