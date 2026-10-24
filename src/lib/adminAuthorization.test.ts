import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: 'a'.repeat(43) }) })) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('redirect_to_login'); }) }));
vi.mock('./adminAuth', () => ({ SESSION_COOKIE: 'session', verifySessionToken: vi.fn() }));
import { verifySessionToken } from './adminAuth';
import { requireAdminSession } from './adminSession';
const verify = vi.mocked(verifySessionToken);
afterEach(() => vi.resetAllMocks());
describe('role checks at protected data entry points', () => {
  it('denies access without a valid database session', async () => {
    verify.mockResolvedValueOnce(null);
    await expect(requireAdminSession()).rejects.toThrow('redirect_to_login');
  });
  it('does not allow ordinary staff to read or triage conversation contents', async () => {
    verify.mockResolvedValueOnce({ userId: 'u', email: 'staff@example.invalid', name: 'Staff', role: 'staff', exp: Date.now() + 1000 });
    await expect(requireAdminSession(['reviewer', 'admin'])).rejects.toMatchObject({ status: 403 });
  });
  it('allows assigned reviewers to access review operations', async () => {
    verify.mockResolvedValueOnce({ userId: 'u', email: 'reviewer@example.invalid', name: 'Reviewer', role: 'reviewer', exp: Date.now() + 1000 });
    await expect(requireAdminSession(['reviewer', 'admin'])).resolves.toMatchObject({ role: 'reviewer' });
  });
});
