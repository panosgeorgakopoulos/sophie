import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireSameOrigin, escapeHtml } from './requestSecurity';
afterEach(() => vi.unstubAllEnvs());
describe('staff mutation boundaries', () => {
  it('fails closed when production has no canonical staff origin', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ORIGIN', '');
    expect(() => requireSameOrigin(new Request('https://staff.example/auth', {
      headers: { origin: 'https://staff.example' },
    }))).toThrow('Staff origin is not configured.');
  });
  it('rejects absent or foreign origins and honors a configured canonical origin', () => {
    vi.stubEnv('APP_ORIGIN', 'https://staff.example');
    expect(() => requireSameOrigin(new Request('https://staff.example/auth'))).toThrow();
    expect(() => requireSameOrigin(new Request('https://staff.example/auth', { headers: { origin: 'https://attacker.example' } }))).toThrow();
    expect(() => requireSameOrigin(new Request('http://internal/auth', { headers: { origin: 'https://staff.example' } }))).not.toThrow();
  });
  it('renders model HTML as inert literal text for any future reviewed email UI', () => {
    expect(escapeHtml('<img src="https://attacker.example/pixel" onerror="x()">&')).toBe('&lt;img src=&quot;https://attacker.example/pixel&quot; onerror=&quot;x()&quot;&gt;&amp;');
  });
});
