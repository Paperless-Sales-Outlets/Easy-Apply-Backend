import 'dotenv/config';
import { pool, query } from '../config/db.js';

// Makes an existing staff account a Super Admin (the only role that can open the
// Backup Dashboard). There is deliberately no screen for this: it is a one-off
// server-side step.
//
//   node scripts/create_super_admin.js someone@slt.lk            # promote
//   node scripts/create_super_admin.js someone@slt.lk --revoke   # back to Admin
//
// The account must already exist (create it in User Management or with
// scripts/init_postgres.js) and must have a password set: restoring and
// downloading ask for it again.

const [email, flag] = process.argv.slice(2);

if (!email || email.startsWith('--')) {
  console.error('Usage: node scripts/create_super_admin.js <email> [--revoke]');
  process.exit(1);
}

try {
  const { rows } = await query('SELECT id, name, role, password_hash FROM users WHERE LOWER(email) = LOWER($1)', [email.trim()]);
  const user = rows[0];
  if (!user) throw new Error(`No staff account with the email "${email}".`);
  if (user.role === 'Customer') throw new Error('That account is a customer, not a staff account.');

  if (flag === '--revoke') {
    await query(`UPDATE users SET role = 'Admin', updated_at = NOW() WHERE id = $1`, [user.id]);
    console.log(`${user.name} is now an Admin (Super Admin access removed).`);
  } else {
    if (!user.password_hash) throw new Error('That account has no password. Set one first: Super Admin actions re-check it.');
    await query(`UPDATE users SET role = 'Super Admin', updated_at = NOW() WHERE id = $1`, [user.id]);
    console.log(`${user.name} is now a Super Admin. They must sign out and back in.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
