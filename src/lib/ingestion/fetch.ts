import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as https from 'node:https';
export const ALLOWED_HOSTS = new Set(['ifg.gr', 'www.ifg.gr']);
export function canonicalUrl(input: string, base?: string): string {
  const url = new URL(input, base);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) throw new Error('URL is outside the HTTPS IFG allowlist');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    // Only globally routed unicast; reject mapped, local, documentation and transition ranges.
    const normalized = address.toLowerCase();
    return /^[23][0-9a-f]{3}:/i.test(normalized) && !/^2001:(?:0:|db8:|2:|10:|20:)/i.test(normalized) && !/^2002:/i.test(normalized);
  }
  return false;
}
export interface FetchResult { url: string; status: number; contentType: string; body: Buffer }
export interface FetchOptions { maxBytes?: number; timeoutMs?: number; maxRedirects?: number }
export async function safeFetch(input: string, options: FetchOptions = {}): Promise<FetchResult> {
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
  const deadline = Date.now() + (options.timeoutMs ?? 20000);
  let current = canonicalUrl(input);
  for (let redirect = 0; redirect <= (options.maxRedirects ?? 4); redirect++) {
    const url = new URL(current);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Fetch deadline exceeded');
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('DNS deadline exceeded')), remaining); timer.unref(); }),
    ]);
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('DNS returned a nonpublic address');
    const address = addresses[0];
    const response = await new Promise<FetchResult & { location?: string }>((resolve, reject) => {
      const req = https.request({
        hostname: address.address, family: address.family, port: 443,
        servername: url.hostname, method: 'GET', path: url.pathname + url.search,
        headers: { Host: url.host, 'User-Agent': 'SophieIngest/2.0 (+https://www.ifg.gr)', Accept: 'text/html, application/pdf, application/xml, text/xml, text/plain', 'Accept-Encoding': 'identity' },
        // Pin the verified DNS answer for the connection, preventing DNS rebinding.
        rejectUnauthorized: true,
      }, (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) { res.resume(); resolve({ url: current, status, body: Buffer.alloc(0), contentType: '', location: res.headers.location }); return; }
        res.on('error', reject);
        if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { res.destroy(new Error('Unexpected compressed response')); return; }
        if (Number(res.headers['content-length'] ?? 0) > maxBytes) { res.destroy(new Error('Response exceeds byte limit')); return; }
        const parts: Buffer[] = [];
        let bytes = 0;
        res.on('data', (part: Buffer) => {
          bytes += part.length;
          if (bytes > maxBytes) { res.destroy(new Error('Response exceeds byte limit')); return; }
          parts.push(part);
        });
        res.on('end', () => resolve({ url: current, status, body: Buffer.concat(parts), contentType: String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() }));
      });
      const timer = setTimeout(() => req.destroy(new Error('Fetch deadline exceeded')), Math.max(1, deadline - Date.now()));
      timer.unref();
      req.once('close', () => clearTimeout(timer));
      req.on('error', reject);
      req.end();
    });
    if (response.location) { current = canonicalUrl(response.location, current); continue; }
    if ([301, 302, 303, 307, 308].includes(response.status)) throw new Error('Redirect missing location');
    return response;
  }
  throw new Error('Redirect limit exceeded');
}
