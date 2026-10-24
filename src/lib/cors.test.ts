import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkCors } from './cors';
afterEach(() => vi.unstubAllEnvs());
describe('public browser boundary', () => {
  it('does not implicitly permit localhost or an arbitrary site in production', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('APP_ORIGIN', 'https://assistant.ifg.gr'); vi.stubEnv('ALLOWED_ORIGINS', 'https://www.ifg.gr');
    expect(checkCors('http://localhost:3000').allowed).toBe(false);
    expect(checkCors('https://attacker.example').allowed).toBe(false);
    expect(checkCors('https://www.ifg.gr').allowed).toBe(true);
    expect(checkCors('https://assistant.ifg.gr').headers['Access-Control-Allow-Methods']).toContain('DELETE');
  });
});
