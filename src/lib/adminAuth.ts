import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query } from './db';

export const SESSION_COOKIE = 'sophie_admin_session';
export const SESSION_MAX_AGE_SECONDS = 4 * 60 * 60;
export const ADMIN_ROLES = ['staff', 'reviewer', 'admin'] as const;
export type AdminRole = typeof ADMIN_ROLES[number];
export interface AdminSessionPayload {
  userId: string;
  email: string;
  name: string;
  role: AdminRole;
  exp: number;
}
export function isAdminRole(role: string): role is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}
function tokenHash(token: string): string { return crypto.createHash('sha256').update(token).digest('hex'); }

/** Only a random bearer value reaches the browser; the DB stores its SHA-256 hash. */
export async function createSessionToken(user: { id: string; session_version: number }): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const result = await query(`
    INSERT INTO admin_sessions (token_hash, user_id, session_version, expires_at)
    SELECT $1, id, session_version, now() + ($3 * interval '1 second')
    FROM admin_users WHERE id = $2 AND disabled_at IS NULL AND role IN ('staff', 'reviewer', 'admin') AND session_version = $4
    RETURNING token_hash
  `, [tokenHash(token), user.id, SESSION_MAX_AGE_SECONDS, user.session_version]);
  if (result.rows.length !== 1) throw new Error('Session creation denied');
  return token;
}

export async function verifySessionToken(token: string | undefined | null): Promise<AdminSessionPayload | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { rows } = await query<{ user_id: string; email: string; name: string; role: string; expires_at: Date }>(`
    SELECT u.id AS user_id, u.email, u.name, u.role, s.expires_at
    FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now() AND u.disabled_at IS NULL
      AND s.session_version = u.session_version
  `, [tokenHash(token)]);
  const user = rows[0];
  if (!user || !isAdminRole(user.role)) return null;
  return { userId: user.user_id, email: user.email, name: user.name, role: user.role, exp: new Date(user.expires_at).getTime() };
}

export async function revokeSessionToken(token: string | undefined): Promise<void> {
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) await query('DELETE FROM admin_sessions WHERE token_hash = $1', [tokenHash(token)]);
}
export function hashPassword(password: string): Promise<string> { return bcrypt.hash(password, 12); }
export function verifyPassword(password: string, hash: string): Promise<boolean> { return bcrypt.compare(password, hash); }
