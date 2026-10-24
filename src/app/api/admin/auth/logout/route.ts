import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, revokeSessionToken } from '@/lib/adminAuth';
import { requireSameOrigin } from '@/lib/requestSecurity';
import { toSafeErrorResponse } from '@/lib/apiError';

export async function POST(req: Request) {
  try {
    requireSameOrigin(req);
    await revokeSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
    const response = NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
    return response;
  } catch (error) {
    return toSafeErrorResponse(error, 'admin_logout');
  }
}
