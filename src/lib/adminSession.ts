import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySessionToken, type AdminSessionPayload } from './adminAuth';

export async function getAdminSession(): Promise<AdminSessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}
