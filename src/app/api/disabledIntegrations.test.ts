import { describe, expect, it } from 'vitest';
import { POST as draftEmail } from './draft-email/route';
import { POST as formWebhook } from './webhook/google-form/route';
describe('retired unsafe email integrations', () => {
  it('never advertises a drafted or delivered email without the reviewed workflow', async () => {
    for (const handler of [draftEmail, formWebhook]) {
      const response = await handler();
      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data).not.toHaveProperty('success', true);
      expect(data).not.toHaveProperty('draft');
      expect(data).not.toHaveProperty('sources');
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
});
