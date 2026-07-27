import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { route } from "../src/shared/route";
import { HttpError } from "../src/shared/errors";

// The route() wrapper turns thrown errors into responses: an HttpError becomes
// its status + message; anything else is a logged generic 500.

function fakeRes() {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response["status"];
  res.json = vi.fn((b: unknown) => {
    res.body = b;
    return res;
  }) as unknown as Response["json"];
  return res;
}

describe("route()", () => {
  it("maps an HttpError to its status and message", async () => {
    const res = fakeRes();
    await route(async () => {
      throw new HttpError(404, "Not here.");
    })({} as Request, res, () => {});
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Not here." });
  });

  it("maps an unexpected error to a generic 500", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = fakeRes();
    await route(async () => {
      throw new Error("kaboom");
    })({} as Request, res, () => {});
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error." });
    errSpy.mockRestore();
  });

  it("passes through a handler that responds normally", async () => {
    const res = fakeRes();
    await route(async (_req, r) => {
      r.status(200).json({ ok: true });
    })({} as Request, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
