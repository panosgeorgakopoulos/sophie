import { HttpError } from './httpError';

/** Cookie-authenticated mutations must originate from this application. */
export function requireSameOrigin(req: Request): void {
  if(process.env.NODE_ENV==='production'&&!process.env.APP_ORIGIN) throw new HttpError(503,'Staff origin is not configured.');
  const origin = req.headers.get('origin');
  const expected = process.env.APP_ORIGIN || new URL(req.url).origin;
  if (origin !== expected || req.headers.get('sec-fetch-site') === 'cross-site') {
    throw new HttpError(403, 'Request origin is not permitted.');
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}
