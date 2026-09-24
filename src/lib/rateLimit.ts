// In-memory sliding-window rate limiter keyed by an identifier (typically
// client IP). This protects the scarce resource that actually matters here
// (free-tier Gemini quota + DB load) without requiring a new external service
// for the MVP.
//
// Trade-off: this tracks state per server process. On a platform that runs
// multiple concurrent instances (e.g. serverless with high concurrency), each
// instance enforces its own limit, so the effective ceiling is per-instance
// rather than global. That's an accepted MVP trade-off -- it still meaningfully
// throttles casual abuse and protects quota. If usage grows enough that this
// matters, swap this module for a shared store (e.g. Upstash Redis via the
// Vercel Marketplace) behind the same checkRateLimit() signature.

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < options.windowMs);

  if (bucket.timestamps.length >= options.limit) {
    buckets.set(key, bucket);
    const oldest = bucket.timestamps[0];
    return { success: false, remaining: 0, retryAfterMs: Math.max(0, options.windowMs - (now - oldest)) };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return { success: true, remaining: options.limit - bucket.timestamps.length, retryAfterMs: 0 };
}

export function getClientKey(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}

// Periodic sweep so long-lived server processes don't accumulate unbounded
// entries for one-off/rotating IPs.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 10 * 60 * 1000;
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.timestamps.every((t) => now - t > STALE_AFTER_MS)) {
      buckets.delete(key);
    }
  }
}, SWEEP_INTERVAL_MS);
sweepTimer.unref?.();
