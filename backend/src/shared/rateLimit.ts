import { type Request, type Response, type NextFunction } from "express";

// ---------------------------------------------------------------------------
// Tiny in-memory rate limiter (no extra deps). Keyed by client IP per limiter
// instance. server.ts sets `trust proxy`, so req.ip is the real client behind
// the Apache reverse proxy rather than the proxy itself.
//
// Fine for our single-process deployment. If we ever run more than one node,
// this needs a shared store (Redis) — each process would otherwise keep its own
// counters and the effective limit would multiply by the process count.
// ---------------------------------------------------------------------------

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Body message for the 429. Defaults to a generic "too many requests". */
  message?: string;
}

export interface RateLimiter {
  (req: Request, res: Response, next: NextFunction): void;
  /** Number of buckets currently held. Exposed so tests can assert eviction. */
  size(): number;
}

export function rateLimit(opts: RateLimitOptions): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const message = opts.message ?? "Too many requests. Please try again later.";

  // Without this the map grows once per distinct IP forever. Sweeping the
  // whole map on a *new* window (rather than per request) keeps the common
  // path O(1) while still bounding memory to the IPs active in one window.
  function evictExpired(now: number) {
    for (const [k, v] of hits) {
      if (now >= v.resetAt) hits.delete(k);
    }
  }

  const limiter = (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now >= entry.resetAt) {
      evictExpired(now);
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }

    entry.count += 1;
    if (entry.count > opts.max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: message });
      return;
    }
    next();
  };

  limiter.size = () => hits.size;
  return limiter;
}
