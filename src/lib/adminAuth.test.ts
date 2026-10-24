import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./db', () => ({ query: vi.fn() }));
import { query } from './db';
import { createSessionToken, revokeSessionToken, verifySessionToken } from './adminAuth';
const database = vi.mocked(query);
afterEach(() => vi.resetAllMocks());
describe('revocable staff authentication', () => {
  it('stores only a hash of a random token and rejects signed legacy cookies', async () => {
    database.mockResolvedValueOnce({ rows: [{ token_hash: 'stored' }] } as never);
    const token = await createSessionToken({ id: '00000000-0000-0000-0000-000000000001', session_version: 1 });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(database.mock.calls[0][1]?.[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(database.mock.calls[0][0]).toContain('session_version = $4');
    expect(database.mock.calls[0][1]?.[3]).toBe(1);
    expect(JSON.stringify(database.mock.calls)).not.toContain(token);
    await expect(verifySessionToken('eyJ1c2VySWQiOiJ4In0.signature')).resolves.toBeNull();
    expect(database).toHaveBeenCalledTimes(1);
  });
  it('checks expiry, disablement, current role and credential version on every lookup', async () => {
    database.mockResolvedValueOnce({ rows: [{ user_id: 'u', email: 'staff@example.invalid', name: 'Staff', role: 'reviewer', expires_at: new Date(Date.now() + 1000) }] } as never);
    await expect(verifySessionToken('a'.repeat(43))).resolves.toMatchObject({ role: 'reviewer' });
    const sql = database.mock.calls[0][0];
    expect(sql).toContain('s.expires_at > now()');
    expect(sql).toContain('u.disabled_at IS NULL');
    expect(sql).toContain('s.session_version = u.session_version');
  });
  it('rejects revoked, expired and unrecognized-role sessions', async () => {
    database.mockResolvedValueOnce({ rows: [] } as never);
    await expect(verifySessionToken('a'.repeat(43))).resolves.toBeNull();
    database.mockResolvedValueOnce({ rows: [{ role: 'unrecognized' }] } as never);
    await expect(verifySessionToken('a'.repeat(43))).resolves.toBeNull();
  });
  it('deletes the bearer hash on logout and does not authenticate during DB outage', async () => {
    database.mockResolvedValueOnce({ rows: [] } as never);
    await revokeSessionToken('a'.repeat(43));
    expect(database.mock.calls[0][0]).toContain('DELETE FROM admin_sessions');
    database.mockRejectedValueOnce(new Error('offline'));
    await expect(verifySessionToken('a'.repeat(43))).rejects.toThrow('offline');
  });
});
