import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { query } from './db';
import { HttpError } from './httpError';

export interface RateLimitOptions { limit: number; windowMs: number }
export interface RateLimitResult { success: boolean; remaining: number; retryAfterMs: number }
interface Bucket { count: number; expiresAt: number }
const buckets = new Map<string, Bucket>();

/** Shared fixed-window counter. The database's clock and UPSERT serialize concurrent instances. */
export async function checkRateLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
  const { limit, windowMs } = options;
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new Error('Invalid rate limit configuration');
  }
  const bucketKey = createHash('sha256').update(`${windowMs}:${limit}:${key}`).digest('hex');
  if (process.env.NODE_ENV === 'production' || process.env.RATE_LIMIT_STORE === 'postgres') {
    try {
      const { rows } = await query<{ hits: number; retry_after_ms: number }>(`
        INSERT INTO rate_limit_buckets (bucket_key, hits, expires_at)
        VALUES ($1, 1, clock_timestamp() + ($2 * interval '1 millisecond'))
        ON CONFLICT (bucket_key) DO UPDATE SET
          hits = CASE WHEN rate_limit_buckets.expires_at <= clock_timestamp() THEN 1
                 ELSE LEAST(rate_limit_buckets.hits + 1, $3 + 1) END,
          expires_at = CASE WHEN rate_limit_buckets.expires_at <= clock_timestamp()
                       THEN clock_timestamp() + ($2 * interval '1 millisecond')
                       ELSE rate_limit_buckets.expires_at END
        RETURNING hits, GREATEST(0, CEIL(EXTRACT(EPOCH FROM (expires_at - clock_timestamp())) * 1000))::integer AS retry_after_ms
      `, [bucketKey, windowMs, limit]);
      if (!rows[0]) throw new Error('Missing rate limit result');
      return {
        success: rows[0].hits <= limit,
        remaining: Math.max(0, limit - rows[0].hits),
        retryAfterMs: rows[0].hits <= limit ? 0 : rows[0].retry_after_ms,
      };
    } catch {
      // A failed shared store must never silently expand quota using a local fallback.
      throw new HttpError(503, 'Service temporarily unavailable. Please try again shortly.');
    }
  }
  const now = Date.now();
  if (buckets.size >= 10_000) {
    for (const [storedKey, bucket] of buckets) if (bucket.expiresAt <= now) buckets.delete(storedKey);
    if (buckets.size >= 10_000 && !buckets.has(bucketKey)) throw new HttpError(503, 'Service temporarily unavailable.');
  }
  const existing = buckets.get(bucketKey);
  const bucket = existing && existing.expiresAt > now ? existing : { count: 0, expiresAt: now + windowMs };
  bucket.count = Math.min(limit + 1, bucket.count + 1);
  buckets.set(bucketKey, bucket);
  return { success: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count), retryAfterMs: bucket.count <= limit ? 0 : bucket.expiresAt - now };
}

export function getClientKey(req: Request): string {
  // Set ONLY to a header overwritten by a trusted ingress; block direct origin access.
  // Never accept a forwarding chain supplied by a browser. Missing configuration
  // deliberately groups clients into one conservative bucket instead of trusting spoofed IPs.
  const trustedHeader = process.env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  const value = trustedHeader ? req.headers.get(trustedHeader)?.trim() : undefined;
  return value && isIP(value) ? value.toLowerCase() : 'unknown';
}
