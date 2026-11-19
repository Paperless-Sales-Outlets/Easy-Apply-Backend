import 'dotenv/config';
import fs from 'node:fs';
import { decryptFile, sha256File } from '../services/backup/crypto.js';

// Offline helper: turns a downloaded .sltbak file back into a plain tar that
// contains database.dump (and uploads.tgz for "Database + uploaded files").
// Needs the same BACKUP_ENCRYPTION_KEY the backup was made with.
//
//   node scripts/backup_decrypt.js backup.sltbak backup.tar
//   tar -xf backup.tar          -> database.dump, manifest.json [, uploads.tgz]
//   pg_restore --list database.dump
//
// The key is read from the environment only; it is never printed.

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/backup_decrypt.js <input.sltbak> <output.tar>');
  process.exit(1);
}
if (!fs.existsSync(input)) {
  console.error(`File not found: ${input}`);
  process.exit(1);
}
if (fs.existsSync(output)) {
  console.error(`Refusing to overwrite ${output}`);
  process.exit(1);
}

try {
  console.log(`SHA-256 of the encrypted file: ${await sha256File(input)}`);
  await decryptFile(input, output);
  console.log(`Decrypted to ${output}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
