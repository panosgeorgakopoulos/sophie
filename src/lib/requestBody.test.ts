import { describe, expect, it } from 'vitest';
import { readJsonBody } from './requestBody';

const req = (body: string, headers: Record<string, string> = {}) => new Request('https://app.example/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
describe('bounded JSON input', () => {
  it('accepts Greek and French JSON within the byte budget', async () => {
    await expect(readJsonBody(req('{"text":"Ελλάδα français"}'), { maxBytes: 100 })).resolves.toEqual({ text: 'Ελλάδα français' });
  });
  it('counts UTF-8 bytes rather than characters, without trusting a missing length header', async () => {
    await expect(readJsonBody(req('"αααα"'), { maxBytes: 6 })).rejects.toMatchObject({ status: 413 });
  });
  it('rejects a declared oversize body before reading it', async () => {
    await expect(readJsonBody(req('{}', { 'Content-Length': '2000' }), { maxBytes: 100 })).rejects.toMatchObject({ status: 413 });
  });
  it('rejects malformed JSON and incompatible media types', async () => {
    await expect(readJsonBody(req('{'), { maxBytes: 100 })).rejects.toMatchObject({ status: 400 });
    await expect(readJsonBody(req('{}', { 'Content-Type': 'text/plain' }), { maxBytes: 100 })).rejects.toMatchObject({ status: 415 });
  });
  it('stops chunked input once cumulative bytes exceed the cap', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"a":"')); controller.enqueue(new Uint8Array(40)); },
      cancel() { cancelled = true; },
    });
    const request = new Request('https://app.example/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half' } as RequestInit);
    await expect(readJsonBody(request, { maxBytes: 20 })).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });
});
