import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken, type AdminRole, type AdminSessionPayload } from './adminAuth';
import { HttpError } from './httpError';

export async function getAdminSession(): Promise<AdminSessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

/** Call at every protected data entry point; layouts alone do not serialize children. */
export async function requireAdminSession(roles: readonly AdminRole[] = ['staff', 'reviewer', 'admin']): Promise<AdminSessionPayload> {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  if (!roles.includes(session.role)) throw new HttpError(403, 'This account does not have access to this operation.');
  return session;
}
