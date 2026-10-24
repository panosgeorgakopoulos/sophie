import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./db', () => ({ query: vi.fn() }));
import { query } from './db';
import { checkRateLimit, getClientKey } from './rateLimit';
const database = vi.mocked(query);
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe('trusted client identity', () => {
  it('ignores caller-controlled forwarding headers unless ingress is explicitly configured', () => {
    vi.stubEnv('TRUSTED_CLIENT_IP_HEADER', '');
    expect(getClientKey(new Request('https://app.example', { headers: { 'x-forwarded-for': '192.0.2.1', 'x-real-ip': '192.0.2.2' } }))).toBe('unknown');
  });
  it('requires a single valid IP in the configured header and rejects chains', () => {
    vi.stubEnv('TRUSTED_CLIENT_IP_HEADER', 'x-ingress-ip');
    expect(getClientKey(new Request('https://app.example', { headers: { 'x-ingress-ip': '192.0.2.1' } }))).toBe('192.0.2.1');
    expect(getClientKey(new Request('https://app.example', { headers: { 'x-ingress-ip': '192.0.2.1, 192.0.2.2' } }))).toBe('unknown');
    expect(getClientKey(new Request('https://app.example', { headers: { 'x-ingress-ip': 'fake-user-1' } }))).toBe('unknown');
  });
});
describe('quota enforcement', () => {
  it('cannot bypass a development bucket by rotating untrusted forwarding headers', async () => {
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('RATE_LIMIT_STORE', ''); vi.stubEnv('TRUSTED_CLIENT_IP_HEADER', '');
    const results = [];
    for (let index = 0; index < 4; index++) {
      const key = getClientKey(new Request('https://app.example', { headers: { 'x-forwarded-for': `192.0.2.${index + 1}` } }));
      results.push(await checkRateLimit(`rotation-test:${key}`, { limit: 2, windowMs: 60_000 }));
    }
    expect(results.map((result) => result.success)).toEqual([true, true, false, false]);
  });
  it('uses shared database state in production and never stores raw IP/email keys', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    database.mockResolvedValueOnce({ rows: [{ hits: 9, retry_after_ms: 3000 }] } as never);
    expect(await checkRateLimit('login:person@example.invalid', { limit: 8, windowMs: 60_000 })).toEqual({ success: false, remaining: 0, retryAfterMs: 3000 });
    const [sql, parameters] = database.mock.calls[0];
    expect(sql).toContain('ON CONFLICT');
    expect(parameters?.[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(parameters)).not.toContain('person@example.invalid');
  });
  it('fails closed when the shared store is unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'production'); database.mockRejectedValueOnce(new Error('database secret'));
    await expect(checkRateLimit('x', { limit: 8, windowMs: 60_000 })).rejects.toMatchObject({ status: 503 });
  });
});
