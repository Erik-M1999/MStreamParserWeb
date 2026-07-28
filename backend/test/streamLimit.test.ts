import { describe, it, expect } from "vitest";
import {
  createStreamLimiter,
  MAX_STREAMS_PER_USER,
} from "../src/shared/streamLimit";

// Unit tests for the SSE concurrency cap (pure bookkeeping — no HTTP).

describe("createStreamLimiter", () => {
  it("allows up to the cap and refuses beyond it", () => {
    const limiter = createStreamLimiter(2);
    expect(limiter.acquire(1)).not.toBeNull();
    expect(limiter.acquire(1)).not.toBeNull();
    expect(limiter.acquire(1)).toBeNull();
    expect(limiter.count(1)).toBe(2);
  });

  it("frees capacity when a stream closes", () => {
    const limiter = createStreamLimiter(1);
    const slot = limiter.acquire(1)!;
    expect(limiter.acquire(1)).toBeNull();

    slot.release();
    expect(limiter.count(1)).toBe(0);
    expect(limiter.acquire(1)).not.toBeNull();
  });

  // A socket can emit "close" twice; counting that twice would hand the user
  // extra capacity and let them exceed the cap.
  it("ignores a repeated release", () => {
    const limiter = createStreamLimiter(2);
    const a = limiter.acquire(1)!;
    limiter.acquire(1);
    a.release();
    a.release();
    a.release();
    expect(limiter.count(1)).toBe(1);
  });

  it("counts each user separately", () => {
    const limiter = createStreamLimiter(1);
    expect(limiter.acquire(1)).not.toBeNull();
    expect(limiter.acquire(1)).toBeNull();
    // A different account is unaffected by the first one's usage.
    expect(limiter.acquire(2)).not.toBeNull();
  });

  it("forgets users once their last stream closes", () => {
    const limiter = createStreamLimiter(2);
    const slot = limiter.acquire(42)!;
    slot.release();
    expect(limiter.count(42)).toBe(0);
  });

  it("defaults to the shared per-user cap", () => {
    const limiter = createStreamLimiter();
    for (let i = 0; i < MAX_STREAMS_PER_USER; i++) {
      expect(limiter.acquire(1)).not.toBeNull();
    }
    expect(limiter.acquire(1)).toBeNull();
  });
});
