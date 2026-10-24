import { getAdminSession } from './adminSession';
import type { AdminRole } from './adminAuth';
import { requireSameOrigin } from './requestSecurity';
import { checkRateLimit } from './rateLimit';
import { HttpError } from './httpError';

export async function authorizeAdminApi(req: Request, roles: readonly AdminRole[] = ['reviewer', 'admin']) {
  const session = await getAdminSession();
  if (!session) throw new HttpError(401, 'Staff sign-in required.');
  if (!roles.includes(session.role)) throw new HttpError(403, 'Reviewer access required.');
  if (req.method !== 'GET') requireSameOrigin(req);
  const quota = await checkRateLimit(`admin-api:${session.userId}`, { limit: 60, windowMs: 60_000 });
  if (!quota.success) throw new HttpError(429, 'Too many requests. Try again shortly.');
  return session;
}
