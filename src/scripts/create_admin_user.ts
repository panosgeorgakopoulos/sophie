// Bootstraps or resets an admin dashboard account. There is no public
// self-registration endpoint by design -- staff accounts are created by
// whoever has server/DB access, via this CLI.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { pool } from '../lib/db';
import { hashPassword } from '../lib/adminAuth';

async function main() {
  const [email, password, name, role] = process.argv.slice(2);
  if (!email || !password || !name) {
    console.error('Usage: npx tsx src/scripts/create_admin_user.ts <email> <password> <name> [role]');
    console.error('Example: npx tsx src/scripts/create_admin_user.ts marie@ifg.gr "s3cur3-pass" "Marie Dupont" staff');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const { rows } = await pool.query(
    `INSERT INTO admin_users (email, password_hash, name, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET password_hash = $2, name = $3, role = $4
     RETURNING email, name, role`,
    [email.toLowerCase().trim(), passwordHash, name, role || 'staff'],
  );

  console.log(`Admin account ready: ${rows[0].email} (${rows[0].name}, role: ${rows[0].role})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
