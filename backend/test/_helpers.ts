import { vi, type Mock } from "vitest";
import jwt from "jsonwebtoken";
import express, { type Express } from "express";
import type { Server } from "node:http";

// ---------------------------------------------------------------------------
// Test helpers for mocking the global fetch used by the Spotify/Last.fm/
// rendering services. Node 24 ships a WHATWG `Response`, so we build real
// Response objects — `.ok`, `.status`, `.json()`, `.text()` all behave.
// ---------------------------------------------------------------------------

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function textResponse(text: string, status = 200): Response {
  return new Response(text, { status, headers: { "content-type": "text/plain" } });
}

/** 204 No Content (Spotify returns this when nothing is playing). */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** Installs a fresh fetch mock that returns the given responses in order.
 *  Returns the mock so a test can assert on the URLs/headers it was called with. */
export function mockFetchSequence(...responses: Response[]): Mock {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Installs a fetch mock that returns the same response for every call. */
export function mockFetchAlways(response: Response | (() => Response)): Mock {
  const fn = vi.fn(async () =>
    typeof response === "function" ? response() : response,
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

// --- HTTP route-test helpers ----------------------------------------------

/** A Cookie header with a valid login JWT (signed with the test JWT_SECRET). */
export function authCookie(
  payload: { userId: number; email: string; username: string } = {
    userId: 1,
    email: "erik@test.local",
    username: "erik",
  },
): string {
  const token = jwt.sign(payload, process.env.JWT_SECRET!);
  return `imd_token=${token}`;
}

export interface TestApp {
  base: string;
  close: () => Promise<void>;
}

/** Boots an Express app on an ephemeral port with JSON + raw-SVG body parsing.
 *  `configure` mounts the router(s) under test. */
export async function startApp(configure: (app: Express) => void): Promise<TestApp> {
  const app = express();
  app.use(express.text({ type: ["image/svg+xml", "text/plain"], limit: "2mb" }));
  app.use(express.json());
  configure(app);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Opens an SSE endpoint, reads the first `data:` payload, then aborts so the
 *  server's close handler clears its timers. */
export async function readFirstSSE(url: string, cookie: string): Promise<string> {
  const controller = new AbortController();
  const res = await fetch(url, {
    headers: { Cookie: cookie, Accept: "text/event-stream" },
    signal: controller.signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (let i = 0; i < 20; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(/data: (.+)\n\n/);
      if (match) return match[1];
    }
    return buffer;
  } finally {
    controller.abort();
    reader.cancel().catch(() => {});
  }
}
