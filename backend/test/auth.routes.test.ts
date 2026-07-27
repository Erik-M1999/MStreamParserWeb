import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { HttpError } from "../src/shared/errors";
import { startApp, authCookie, type TestApp } from "./_helpers";

// Auth-route HTTP concerns: cookie set/clear, /me guard, rate limiting.
// The credential logic (auth.service) is mocked — tested separately.
vi.mock("../src/modules/auth/auth.service", () => ({
  register: vi.fn(),
  login: vi.fn(),
  TOKEN_TTL_SECONDS: 3600,
}));

import authRouter from "../src/modules/auth/auth.routes";
import * as authService from "../src/modules/auth/auth.service";

const svc = authService as unknown as { register: Mock; login: Mock };

let app: TestApp;

beforeEach(async () => {
  vi.clearAllMocks();
  svc.register.mockResolvedValue({ id: 1, username: "erik" });
  svc.login.mockResolvedValue({ token: "tok", user: { id: 1, username: "erik", email: "e@x" } });
  app = await startApp((a) => a.use("/api", authRouter));
});

afterEach(async () => await app.close());

const postJson = (path: string, body: unknown) =>
  fetch(`${app.base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("auth routes", () => {
  it("register returns 201 with the created user", async () => {
    const res = await postJson("/api/auth/register", { email: "e@x", username: "erik", password: "password123" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 1, username: "erik" });
  });

  it("login sets the HttpOnly auth cookie and returns the user", async () => {
    const res = await postJson("/api/auth/login", { username: "erik", password: "password123" });
    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie().join(";");
    expect(setCookie).toContain("imd_token=");
    expect(setCookie.toLowerCase()).toContain("httponly");
  });

  it("propagates a login failure as its HTTP status", async () => {
    svc.login.mockRejectedValueOnce(new HttpError(401, "Username or password is invalid."));
    const res = await postJson("/api/auth/login", { username: "erik", password: "nope" });
    expect(res.status).toBe(401);
  });

  it("logout clears the cookie", async () => {
    const res = await fetch(`${app.base}/api/auth/logout`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().join(";")).toContain("imd_token=");
  });

  it("me returns 401 without a cookie and the user with a valid one", async () => {
    const anon = await fetch(`${app.base}/api/auth/me`);
    expect(anon.status).toBe(401);

    const authed = await fetch(`${app.base}/api/auth/me`, { headers: { Cookie: authCookie() } });
    expect(authed.status).toBe(200);
    expect((await authed.json()).username).toBe("erik");
  });

  // Defined LAST: it exhausts the shared in-memory limiter for this worker.
  it("rate-limits repeated auth attempts with 429 + Retry-After", async () => {
    let sawLimited: Response | null = null;
    for (let i = 0; i < 15; i++) {
      const res = await postJson("/api/auth/login", { username: "erik", password: "password123" });
      if (res.status === 429) {
        sawLimited = res;
        break;
      }
    }
    expect(sawLimited).not.toBeNull();
    expect(sawLimited!.headers.get("Retry-After")).toBeTruthy();
  });
});
