import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { rateLimit } from "../src/shared/rateLimit";

// Unit tests for the shared in-memory limiter (pure logic — no HTTP server).
// Time is faked so window expiry is deterministic.

function fakeReq(ip: string | undefined): Request {
  return { ip } as Request;
}

function fakeRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(k: string, v: string) {
      res.headers[k.toLowerCase()] = v;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response & typeof res;
}

/** Runs the limiter once; returns true if the request was allowed through. */
function call(limiter: ReturnType<typeof rateLimit>, ip = "1.1.1.1") {
  const res = fakeRes();
  const next = vi.fn() as unknown as NextFunction;
  limiter(fakeReq(ip), res, next);
  return { allowed: (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0, res };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("rateLimit", () => {
  it("allows requests up to max and blocks the next one", () => {
    const limiter = rateLimit({ windowMs: 1000, max: 3 });
    expect(call(limiter).allowed).toBe(true);
    expect(call(limiter).allowed).toBe(true);
    expect(call(limiter).allowed).toBe(true);

    const blocked = call(limiter);
    expect(blocked.allowed).toBe(false);
    expect(blocked.res.statusCode).toBe(429);
    expect(blocked.res.headers["retry-after"]).toBeDefined();
  });

  it("uses the custom message when given, and a default otherwise", () => {
    const custom = rateLimit({ windowMs: 1000, max: 1, message: "slow down!" });
    call(custom);
    expect((call(custom).res.body as { error: string }).error).toBe("slow down!");

    const plain = rateLimit({ windowMs: 1000, max: 1 });
    call(plain);
    expect((call(plain).res.body as { error: string }).error).toMatch(/Too many requests/);
  });

  it("counts each IP separately", () => {
    const limiter = rateLimit({ windowMs: 1000, max: 1 });
    expect(call(limiter, "1.1.1.1").allowed).toBe(true);
    expect(call(limiter, "1.1.1.1").allowed).toBe(false);
    // A different client is unaffected by the first one's budget.
    expect(call(limiter, "2.2.2.2").allowed).toBe(true);
  });

  it("falls back to a shared bucket when req.ip is undefined", () => {
    const limiter = rateLimit({ windowMs: 1000, max: 1 });
    expect(call(limiter, undefined).allowed).toBe(true);
    expect(call(limiter, undefined).allowed).toBe(false);
  });

  it("starts a fresh budget once the window has elapsed", () => {
    const limiter = rateLimit({ windowMs: 1000, max: 1 });
    expect(call(limiter).allowed).toBe(true);
    expect(call(limiter).allowed).toBe(false);

    vi.advanceTimersByTime(1001);
    expect(call(limiter).allowed).toBe(true);
  });

  // The finding this closes: the map used to retain every IP it ever saw.
  it("evicts expired entries instead of growing without bound", () => {
    const limiter = rateLimit({ windowMs: 1000, max: 5 });
    for (let i = 0; i < 500; i++) call(limiter, `10.0.0.${i}`);
    expect(limiter.size()).toBe(500);

    // After the window lapses, one request from a new IP sweeps the stale ones,
    // leaving only that request's own bucket behind.
    vi.advanceTimersByTime(1001);
    call(limiter, "172.16.0.1");
    expect(limiter.size()).toBe(1);
  });

  it("keeps still-active buckets when sweeping", () => {
    const limiter = rateLimit({ windowMs: 1000, max: 5 });
    call(limiter, "10.0.0.1"); // expires at t+1000

    vi.advanceTimersByTime(600);
    call(limiter, "10.0.0.2"); // expires at t+1600 — outlives the first

    vi.advanceTimersByTime(500); // t+1100: first is stale, second is not
    call(limiter, "10.0.0.3");
    expect(limiter.size()).toBe(2); // 10.0.0.1 dropped; .2 and .3 retained
  });
});
