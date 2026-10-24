// Administrative CLI: no password in argv, shell history, environment, or logs.
import * as dotenv from 'dotenv';
import { z } from 'zod';
import { pool } from '../lib/db';
import { hashPassword, isAdminRole } from '../lib/adminAuth';
dotenv.config({ path: '.env.local' });

async function readPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Interactive terminal required');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003' || char === '\u0004') { finish(); reject(new Error('Cancelled')); return; }
        if (char === '\r' || char === '\n') { finish(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = Array.from(value).slice(0, -1).join('');
        else if (char >= ' ' && Buffer.byteLength(value + char, 'utf8') <= 256) value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const [emailInput, name, role = 'staff', ...extra] = process.argv.slice(2);
  const email = z.string().trim().toLowerCase().email().max(254).safeParse(emailInput);
  if (!email.success || !name || name.length > 100 || !isAdminRole(role) || extra.length) {
    throw new Error('Usage: npx tsx src/scripts/create_admin_user.ts <email> <name> [staff|reviewer|admin]');
  }
  const password = await readPassword('New password (hidden; at least 14 characters): ');
  if (Array.from(password).length < 14 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('Password must contain at least 14 characters and at most 72 UTF-8 bytes');
  if (password !== await readPassword('Confirm password (hidden): ')) throw new Error('Passwords do not match');
  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(`
      INSERT INTO admin_users (email, password_hash, name, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE SET password_hash = $2, name = $3, role = $4,
        session_version = admin_users.session_version + 1
      RETURNING id
    `, [email.data, passwordHash, name, role]);
    await client.query('DELETE FROM admin_sessions WHERE user_id = $1', [rows[0].id]);
    await client.query('COMMIT');
    console.log('Staff account saved. Existing sessions revoked. Disabled accounts remain disabled.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
main().catch(() => {
  console.error('Staff account was not saved. Check arguments, password policy, and database migrations.');
  process.exitCode = 1;
}).finally(() => pool.end());
