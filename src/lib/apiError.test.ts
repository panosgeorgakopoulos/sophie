import { describe, expect, it, vi } from 'vitest';
import { toSafeErrorResponse } from './apiError';
import { HttpError } from './httpError';
describe('error redaction', () => {
  it('never serializes third-party exception messages, prompts or connection strings', async () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'postgres://user:password@server/private student@example.invalid';
    const response = toSafeErrorResponse(new Error(secret), 'database_request');
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(secret);
    expect(JSON.stringify(logger.mock.calls)).not.toContain(secret);
    expect(logger).toHaveBeenCalledWith(JSON.stringify({ event: 'request_failed', context: 'database_request', status: 500 }));
    logger.mockRestore();
  });
  it('preserves only deliberately classified status/message failures', async () => {
    const response = toSafeErrorResponse(new HttpError(413, 'Request body is too large.'), 'body');
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Request body is too large.' });
  });
});
