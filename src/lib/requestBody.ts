import { HttpError } from './httpError';

/** Enforces the byte budget while streaming; Content-Length is only an early check. */
export async function readJsonBody(req: Request, { maxBytes }: { maxBytes: number }): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid body byte limit');
  const mediaType = req.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json.');
  const length = req.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new HttpError(413, 'Request body is too large.');
  }
  if (!req.body) throw new HttpError(400, 'A JSON body is required.');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new HttpError(408, 'Request body timed out.')), 5_000);
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new HttpError(413, 'Request body is too large.');
      chunks.push(value);
    }
    const body = Buffer.concat(chunks, total);
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
    } catch {
      throw new HttpError(400, 'Invalid JSON body.');
    }
  } finally {
    clearTimeout(timeout);
    // Do not wait for a hostile/incomplete stream's cancellation to settle.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
