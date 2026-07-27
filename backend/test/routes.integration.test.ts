import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { prisma } from "../src/db";
import authRouter from "../src/modules/auth/auth.routes";
import libraryRouter from "../src/modules/library/library.routes";

// Integration tests: real Express routers against the real DB (dev.db). They
// cover our #1 "most damage" area — authentication + per-user ownership.
// Created users are removed in afterAll; `npm run db:reset` is the backstop.

let server: Server;
let base: string;

// Unique per run so repeated/interrupted runs never collide.
const tag = Date.now().toString(36);
const userA = { email: `a_${tag}@itest.local`, username: `itest_a_${tag}`, password: "password123" };
const userB = { email: `b_${tag}@itest.local`, username: `itest_b_${tag}`, password: "password123" };

let cookieA = "";
let cookieB = "";

function jsonHeaders(cookie?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) h.Cookie = cookie;
  return h;
}

async function register(u: typeof userA) {
  return fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(u),
  });
}

async function login(u: typeof userA): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ username: u.username, password: u.password }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("imd_token="));
  if (!cookie) throw new Error("login did not set the auth cookie");
  return cookie;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", authRouter);
  app.use("/api", libraryRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  await register(userA);
  await register(userB);
  cookieA = await login(userA);
  cookieB = await login(userB);
});

afterAll(async () => {
  // Cascades to the users' folders/templates/connections.
  await prisma.user.deleteMany({
    where: { username: { in: [userA.username, userB.username] } },
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

describe("auth + ownership (integration)", () => {
  it("rejects unauthenticated access with 401", async () => {
    const res = await fetch(`${base}/api/templates`);
    expect(res.status).toBe(401);
  });

  it("rejects an invalid/forged token with 401", async () => {
    const res = await fetch(`${base}/api/templates`, {
      headers: { Cookie: "imd_token=not-a-real-jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("creates a template for its owner and lists it back", async () => {
    const create = await fetch(`${base}/api/templates`, {
      method: "POST",
      headers: jsonHeaders(cookieA),
      body: JSON.stringify({
        name: "A's template",
        svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        mode: "current-song",
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: number };
    expect(created.id).toBeTypeOf("number");

    const list = await fetch(`${base}/api/templates`, { headers: jsonHeaders(cookieA) });
    const rows = (await list.json()) as { id: number }[];
    expect(rows.some((t) => t.id === created.id)).toBe(true);
  });

  it("does not let another user read someone else's template (404)", async () => {
    const create = await fetch(`${base}/api/templates`, {
      method: "POST",
      headers: jsonHeaders(cookieA),
      body: JSON.stringify({
        name: "private to A",
        svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      }),
    });
    const { id } = (await create.json()) as { id: number };

    const asB = await fetch(`${base}/api/templates/${id}`, { headers: jsonHeaders(cookieB) });
    expect(asB.status).toBe(404);
  });

  it("scopes the list so a user only sees their own templates", async () => {
    const create = await fetch(`${base}/api/templates`, {
      method: "POST",
      headers: jsonHeaders(cookieA),
      body: JSON.stringify({
        name: "A only",
        svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      }),
    });
    const { id } = (await create.json()) as { id: number };

    const listB = await fetch(`${base}/api/templates`, { headers: jsonHeaders(cookieB) });
    const rows = (await listB.json()) as { id: number }[];
    expect(rows.some((t) => t.id === id)).toBe(false);
  });

  it("cascades a folder delete to the templates inside it", async () => {
    const folderRes = await fetch(`${base}/api/folders`, {
      method: "POST",
      headers: jsonHeaders(cookieA),
      body: JSON.stringify({ name: "to delete" }),
    });
    const folder = (await folderRes.json()) as { id: number };

    const tplRes = await fetch(`${base}/api/templates`, {
      method: "POST",
      headers: jsonHeaders(cookieA),
      body: JSON.stringify({
        name: "inside folder",
        svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        folderId: folder.id,
      }),
    });
    const tpl = (await tplRes.json()) as { id: number };

    const del = await fetch(`${base}/api/folders/${folder.id}`, {
      method: "DELETE",
      headers: jsonHeaders(cookieA),
    });
    expect(del.status).toBe(204);

    const gone = await fetch(`${base}/api/templates/${tpl.id}`, { headers: jsonHeaders(cookieA) });
    expect(gone.status).toBe(404);
  });
});

// Exercises the remaining Library route wiring end-to-end (GET one, PUT, folder
// reads) so the thin handlers in library.routes.ts are covered, not just the
// service. Uses the same real DB + cookieA from above.
describe("library routes (integration)", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

  it("reads and updates a single template through its route", async () => {
    const created = await fetch(`${base}/api/templates`, {
      method: "POST",
      headers: jsonHeaders(cookieA),
      body: JSON.stringify({ name: "route tpl", svg, mode: "queue" }),
    });
    const { id } = (await created.json()) as { id: number };

    const got = await fetch(`${base}/api/templates/${id}`, { headers: jsonHeaders(cookieA) });
    expect(got.status).toBe(200);
    expect(((await got.json()) as { name: string }).name).toBe("route tpl");

    const put = await fetch(`${base}/api/templates/${id}`, {
      method: "PUT",
      headers: jsonHeaders(cookieA),
      body: JSON.stringify({ name: "renamed", svg }),
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { name: string }).name).toBe("renamed");
  });

  it("lists folders, reads one, lists its templates, and renames it", async () => {
    const folderRes = await fetch(`${base}/api/folders`, {
      method: "POST",
      headers: jsonHeaders(cookieA),
      body: JSON.stringify({ name: "route folder" }),
    });
    const folder = (await folderRes.json()) as { id: number };

    await fetch(`${base}/api/templates`, {
      method: "POST",
      headers: jsonHeaders(cookieA),
      body: JSON.stringify({ name: "in folder", svg, folderId: folder.id }),
    });

    const list = await fetch(`${base}/api/folders`, { headers: jsonHeaders(cookieA) });
    expect(((await list.json()) as { id: number }[]).some((f) => f.id === folder.id)).toBe(true);

    const one = await fetch(`${base}/api/folders/${folder.id}`, { headers: jsonHeaders(cookieA) });
    expect(one.status).toBe(200);

    const inside = await fetch(`${base}/api/folders/${folder.id}/templates`, { headers: jsonHeaders(cookieA) });
    expect(((await inside.json()) as unknown[]).length).toBe(1);

    const renamed = await fetch(`${base}/api/folders/${folder.id}`, {
      method: "PUT",
      headers: jsonHeaders(cookieA),
      body: JSON.stringify({ name: "folder renamed" }),
    });
    expect(renamed.status).toBe(200);

    const byFolder = await fetch(`${base}/api/templates?folderId=${folder.id}`, { headers: jsonHeaders(cookieA) });
    expect(((await byFolder.json()) as unknown[]).length).toBe(1);
  });
});

// Public read-only sample templates (served from disk, no auth).
describe("sample templates (integration)", () => {
  it("lists the bundled demo templates", async () => {
    const res = await fetch(`${base}/api/sample-templates`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; readOnly: boolean }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].readOnly).toBe(true);
  });

  it("serves one template's SVG and rejects traversal / unknown ids", async () => {
    const list = (await (await fetch(`${base}/api/sample-templates`)).json()) as { id: string }[];
    const first = list[0].id;

    const svgRes = await fetch(`${base}/api/sample-templates/${encodeURIComponent(first)}`);
    expect(svgRes.status).toBe(200);
    expect(svgRes.headers.get("content-type")).toContain("image/svg+xml");

    const traversal = await fetch(`${base}/api/sample-templates/x..y`);
    expect(traversal.status).toBe(400);

    const missing = await fetch(`${base}/api/sample-templates/nope.svg`);
    expect(missing.status).toBe(404);
  });
});
