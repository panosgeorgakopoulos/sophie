import { afterEach, describe, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => transport) } }));
import { sendEmail } from './email';
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe('mail delivery contract', () => {
  it('rejects arbitrary recipient lists and header injection before transport access', async () => {
    await expect(sendEmail('a@example.invalid,b@example.invalid', 'Hello', 'Body')).rejects.toThrow('recipient');
    await expect(sendEmail('a@example.invalid', 'Hello\r\nBcc: b@example.invalid', 'Body')).rejects.toThrow('content');
    expect(transport.sendMail).not.toHaveBeenCalled();
  });
  it('does not claim success or log the body without SMTP configuration', async () => {
    vi.stubEnv('SMTP_HOST', '');
    const logger = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(sendEmail('a@example.invalid', 'Subject', 'Private body')).rejects.toThrow('not configured');
    expect(logger).not.toHaveBeenCalled(); logger.mockRestore();
  });
  it('propagates delivery failures and closes the transport', async () => {
    for (const [name, value] of Object.entries({ SMTP_HOST: 'smtp.example.invalid', SMTP_USER: 'user', SMTP_PASS: 'test-only', SMTP_FROM: 'sender@example.invalid', SMTP_PORT: '587' })) vi.stubEnv(name, value);
    transport.sendMail.mockRejectedValueOnce(new Error('delivery failed'));
    await expect(sendEmail('a@example.invalid', 'Subject', 'Body')).rejects.toThrow('delivery failed');
    expect(transport.close).toHaveBeenCalledOnce();
  });
});
