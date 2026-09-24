import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { verifyPassword, createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from '@/lib/adminAuth';
import { checkRateLimit, getClientKey } from '@/lib/rateLimit';
import { toSafeErrorResponse } from '@/lib/apiError';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// A real bcrypt hash of a fixed placeholder, compared against on an
// unknown-email path so response timing doesn't reveal which emails have an
// account.
const DUMMY_HASH = '$2b$12$baJv.5AdN1OcIMAgXfW/euWBbWhHnT7tyZUZ2UZas57fq85H6Lw9u';

export async function POST(req: Request) {
  const clientKey = getClientKey(req);
  const rate = checkRateLimit(`admin-login:${clientKey}`, { limit: 8, windowMs: 5 * 60_000 });
  if (!rate.success) {
    return NextResponse.json({ error: 'Too many login attempts. Please wait a few minutes.' }, { status: 429 });
  }

  let parsed;
  try {
    parsed = LoginSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 400 });
  }

  try {
    const { rows } = await query<{ id: string; email: string; password_hash: string; name: string; role: string }>(
      'SELECT id, email, password_hash, name, role FROM admin_users WHERE email = $1',
      [parsed.email.toLowerCase().trim()],
    );
    const user = rows[0];
    const valid = await verifyPassword(parsed.password, user?.password_hash ?? DUMMY_HASH);

    if (!user || !valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    await query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [user.id]);

    const token = createSessionToken(user);
    const response = NextResponse.json({ name: user.name, role: user.role });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: '/',
    });
    return response;
  } catch (error) {
    return toSafeErrorResponse(error, 'admin login');
  }
}
