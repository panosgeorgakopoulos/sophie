import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { verifyPassword, createSessionToken, isAdminRole, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from '@/lib/adminAuth';
import { checkRateLimit, getClientKey } from '@/lib/rateLimit';
import { toSafeErrorResponse } from '@/lib/apiError';
import { HttpError } from '@/lib/httpError';
import { readJsonBody } from '@/lib/requestBody';
import { requireSameOrigin } from '@/lib/requestSecurity';

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128).refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
}).strict();
const DUMMY_HASH = '$2b$12$baJv.5AdN1OcIMAgXfW/euWBbWhHnT7tyZUZ2UZas57fq85H6Lw9u';

export async function POST(req: Request) {
  try {
    requireSameOrigin(req);
    const rate = await checkRateLimit(`admin-login:${getClientKey(req)}`, { limit: 8, windowMs: 5 * 60_000 });
    if (!rate.success) {
      return NextResponse.json({ error: 'Too many login attempts. Please wait a few minutes.' }, {
        status: 429, headers: { 'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000)), 'Cache-Control': 'no-store' },
      });
    }
    const parsed = LoginSchema.safeParse(await readJsonBody(req, { maxBytes: 2_048 }));
    if (!parsed.success) throw new HttpError(400, 'Invalid email or password');
    const accountRate = await checkRateLimit(`admin-account:${parsed.data.email}`, { limit: 10, windowMs: 15 * 60_000 });
    if (!accountRate.success) throw new HttpError(429, 'Too many login attempts. Please wait a few minutes.');
    const { rows } = await query<{ id: string; email: string; password_hash: string; name: string; role: string; session_version: number }>(
      'SELECT id, email, password_hash, name, role, session_version FROM admin_users WHERE email = $1 AND disabled_at IS NULL',
      [parsed.data.email],
    );
    const user = rows[0];
    const valid = await verifyPassword(parsed.data.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !valid || !isAdminRole(user.role)) throw new HttpError(401, 'Invalid email or password');
    const token = await createSessionToken(user);
    await query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [user.id]);
    const response = NextResponse.json({ name: user.name, role: user.role }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
      maxAge: SESSION_MAX_AGE_SECONDS, path: '/',
    });
    return response;
  } catch (error) {
    return toSafeErrorResponse(error, 'admin_login');
  }
}
