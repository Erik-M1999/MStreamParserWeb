import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { startApp, authCookie, readFirstSSE, type TestApp } from "./_helpers";

// Route-layer tests: mount the real routers, mock the service layer they call.
// This exercises the thin HTTP wiring (auth guards, status mapping, query/body
// parsing, redirects, SSE) without any real network or DB.

vi.mock("../src/modules/spotify/spotify.service", () => ({
  isConfigured: vi.fn(() => true),
  beginConnect: vi.fn(() => "https://accounts.spotify.com/authorize?x=1"),
  isValidAuthState: vi.fn(() => true),
  clearAuthState: vi.fn(),
  exchangeCodeAndStore: vi.fn(),
  disconnect: vi.fn(),
  getProfile: vi.fn(),
  listMyPlaylistsPage: vi.fn(),
  getPlaylistExport: vi.fn(),
  getNowPlaying: vi.fn(),
  getDebugInfo: vi.fn(),
  toNowPlayingPayload: vi.fn((r: unknown) => ({ payload: r })),
  // Real implementation: the routes use it to map an expired Spotify grant to a
  // "reconnect" response instead of a generic 502.
  REAUTH_REQUIRED: "spotify_reauth_required",
  isReauthRequired: (err: unknown) =>
    err instanceof Error && err.message === "spotify_reauth_required",
}));
vi.mock("../src/modules/lastfm/lastfm.service", () => ({
  verifyAndConnect: vi.fn(),
  disconnect: vi.fn(),
  getProfile: vi.fn(),
  getNowPlaying: vi.fn(),
  toNowPlayingPayload: vi.fn((r: unknown) => ({ payload: r })),
}));
vi.mock("../src/modules/rendering/rendering.service", () => ({
  render: vi.fn(),
  svgToPng: vi.fn(),
}));
vi.mock("../src/modules/library/library.service", () => ({
  listTemplatesWithPath: vi.fn(),
  getTemplate: vi.fn(),
}));
vi.mock("../src/modules/apikeys/apikeys.service", () => ({
  createKey: vi.fn(),
  listKeys: vi.fn(),
  revokeKey: vi.fn(),
  verifyKey: vi.fn(),
}));

import spotifyRouter from "../src/modules/spotify/spotify.routes";
import lastfmRouter from "../src/modules/lastfm/lastfm.routes";
import renderingRouter from "../src/modules/rendering/rendering.routes";
import apiKeysRouter from "../src/modules/apikeys/apikeys.routes";
import externalRouter from "../src/modules/external/external.routes";
import * as spotify from "../src/modules/spotify/spotify.service";
import * as lastfm from "../src/modules/lastfm/lastfm.service";
import * as rendering from "../src/modules/rendering/rendering.service";
import * as library from "../src/modules/library/library.service";
import * as apikeys from "../src/modules/apikeys/apikeys.service";

const sp = spotify as unknown as Record<string, Mock>;
const lf = lastfm as unknown as Record<string, Mock>;
const rd = rendering as unknown as Record<string, Mock>;
const lib = library as unknown as Record<string, Mock>;
const keys = apikeys as unknown as Record<string, Mock>;

let app: TestApp;
const cookie = authCookie();
const KEY_HEADER = { Authorization: "Bearer msp_valid" };

beforeEach(async () => {
  vi.clearAllMocks();
  keys.verifyKey.mockResolvedValue({ userId: 1, email: "e@x", username: "erik" });
  app = await startApp((a) => {
    a.use("/api", spotifyRouter);
    a.use("/api", lastfmRouter);
    a.use("/api", renderingRouter);
    a.use("/api", apiKeysRouter);
    a.use("/api", externalRouter);
  });
});

afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
});

// --- external API (API-key auth) ------------------------------------------

describe("external API + apiKeyAuth", () => {
  it("401s without an API key, and on an invalid key", async () => {
    const none = await fetch(`${app.base}/api/v1/whoami`);
    expect(none.status).toBe(401);

    keys.verifyKey.mockResolvedValueOnce(null);
    const bad = await fetch(`${app.base}/api/v1/whoami`, { headers: { Authorization: "Bearer msp_nope" } });
    expect(bad.status).toBe(401);
  });

  it("accepts a valid key via X-API-Key too and returns the owner", async () => {
    const res = await fetch(`${app.base}/api/v1/whoami`, { headers: { "X-API-Key": "msp_valid" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 1, username: "erik" });
  });

  it("lists templates as JSON and as tab-separated text", async () => {
    lib.listTemplatesWithPath.mockResolvedValue([{ id: 7, name: "N", mode: "queue", path: "A/B" }]);

    const json = await fetch(`${app.base}/api/v1/templates`, { headers: KEY_HEADER });
    expect(await json.json()).toEqual([{ id: 7, name: "N", mode: "queue", path: "A/B" }]);

    const text = await fetch(`${app.base}/api/v1/templates?format=text`, { headers: KEY_HEADER });
    expect(await text.text()).toBe("7\tA/B/N\tqueue");
  });

  it("returns a template's raw SVG", async () => {
    lib.getTemplate.mockResolvedValue({ svg: "<svg/>", mode: "queue" });
    const res = await fetch(`${app.base}/api/v1/templates/7`, { headers: KEY_HEADER });
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(await res.text()).toBe("<svg/>");
    // SVG is an active document — served user content must carry the lockdown CSP.
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("renders SVG by default and PNG on ?format=png", async () => {
    lib.getTemplate.mockResolvedValue({ svg: "<svg/>", mode: "current-song" });
    rd.render.mockResolvedValue("<svg>filled</svg>");
    rd.svgToPng.mockReturnValue(Buffer.from([137, 80, 78, 71]));

    const svg = await fetch(`${app.base}/api/v1/render/7`, { headers: KEY_HEADER });
    expect(await svg.text()).toBe("<svg>filled</svg>");
    expect(svg.headers.get("content-security-policy")).toContain("default-src 'none'");

    const png = await fetch(`${app.base}/api/v1/render/7?format=png&size=1024`, { headers: KEY_HEADER });
    expect(png.headers.get("content-type")).toContain("image/png");
    expect(rd.svgToPng).toHaveBeenCalledWith("<svg>filled</svg>", 1024);
  });
});

// --- API keys (cookie auth) -----------------------------------------------

describe("apikeys routes", () => {
  it("401s without a login cookie", async () => {
    const res = await fetch(`${app.base}/api/keys`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("creates, lists and revokes a key", async () => {
    keys.createKey.mockResolvedValue({ id: 1, name: "n", key: "msp_x", createdAt: new Date() });
    keys.listKeys.mockResolvedValue([{ id: 1, name: "n" }]);

    const created = await fetch(`${app.base}/api/keys`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "n" }),
    });
    expect(created.status).toBe(201);

    const list = await fetch(`${app.base}/api/keys`, { headers: { Cookie: cookie } });
    expect((await list.json()) as unknown[]).toHaveLength(1);

    const del = await fetch(`${app.base}/api/keys/1`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(del.status).toBe(204);
  });
});

// --- rendering route -------------------------------------------------------

describe("immersive render route", () => {
  it("401s without a cookie", async () => {
    const res = await fetch(`${app.base}/api/immersive/render`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("fills the posted SVG in the requested mode", async () => {
    rd.render.mockResolvedValue("<svg>ok</svg>");
    const res = await fetch(`${app.base}/api/immersive/render?mode=queue`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "image/svg+xml" },
      body: "<svg/>",
    });
    expect(await res.text()).toBe("<svg>ok</svg>");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(rd.render).toHaveBeenCalledWith(1, "<svg/>", "queue");
  });
});

// --- spotify routes --------------------------------------------------------

describe("spotify routes", () => {
  it("redirects to the consent screen, or 500 when unconfigured", async () => {
    const ok = await fetch(`${app.base}/api/auth/spotify/login`, { headers: { Cookie: cookie }, redirect: "manual" });
    expect(ok.status).toBe(302);

    sp.isConfigured.mockReturnValueOnce(false);
    const unconfigured = await fetch(`${app.base}/api/auth/spotify/login`, { headers: { Cookie: cookie }, redirect: "manual" });
    expect(unconfigured.status).toBe(500);
  });

  it("handles the OAuth callback: success, denied, bad state, missing code", async () => {
    const ok = await fetch(`${app.base}/api/auth/spotify/callback?state=s&code=c`, { headers: { Cookie: cookie }, redirect: "manual" });
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toContain("spotify=connected");

    const denied = await fetch(`${app.base}/api/auth/spotify/callback?error=access_denied`, { headers: { Cookie: cookie }, redirect: "manual" });
    expect(denied.headers.get("location")).toContain("spotify=denied");

    sp.isValidAuthState.mockReturnValueOnce(false);
    const badState = await fetch(`${app.base}/api/auth/spotify/callback?state=bad&code=c`, { headers: { Cookie: cookie }, redirect: "manual" });
    expect(badState.status).toBe(400);

    const noCode = await fetch(`${app.base}/api/auth/spotify/callback?state=s`, { headers: { Cookie: cookie }, redirect: "manual" });
    expect(noCode.status).toBe(400);
  });

  it("redirects to an error page when the token exchange throws", async () => {
    sp.exchangeCodeAndStore.mockRejectedValueOnce(new Error("boom"));
    const res = await fetch(`${app.base}/api/auth/spotify/callback?state=s&code=c`, { headers: { Cookie: cookie }, redirect: "manual" });
    expect(res.headers.get("location")).toContain("spotify=error");
  });

  it("disconnect returns 204", async () => {
    const res = await fetch(`${app.base}/api/spotify/disconnect`, { method: "POST", headers: { Cookie: cookie } });
    expect(res.status).toBe(204);
  });

  it("me: returns data, mirrors upstream failure, and 409 when not connected", async () => {
    sp.getProfile.mockResolvedValueOnce({ ok: true, status: 200, data: { display_name: "Erik" } });
    const ok = await fetch(`${app.base}/api/spotify/me`, { headers: { Cookie: cookie } });
    expect(await ok.json()).toEqual({ display_name: "Erik" });

    sp.getProfile.mockResolvedValueOnce({ ok: false, status: 401, data: null });
    const failed = await fetch(`${app.base}/api/spotify/me`, { headers: { Cookie: cookie } });
    expect(failed.status).toBe(401);

    sp.getProfile.mockRejectedValueOnce(new Error("not_connected"));
    const disconnected = await fetch(`${app.base}/api/spotify/me`, { headers: { Cookie: cookie } });
    expect(disconnected.status).toBe(409);
    expect(await disconnected.json()).toMatchObject({ code: "spotify_not_connected" });
  });

  // Spotify's 6-month refresh-token expiry: the client needs to tell "reconnect"
  // apart from "Spotify is down", so it gets a 409 + machine-readable code rather
  // than the generic 502.
  it("me: returns 409 + a reauth code when the Spotify grant has expired", async () => {
    sp.getProfile.mockRejectedValueOnce(new Error("spotify_reauth_required"));
    const res = await fetch(`${app.base}/api/spotify/me`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.stringMatching(/expired/i),
      code: "spotify_reauth_required",
    });
  });

  it("me: still returns 502 for a genuine Spotify outage", async () => {
    sp.getProfile.mockRejectedValueOnce(new Error("refresh_failed"));
    const res = await fetch(`${app.base}/api/spotify/me`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(502);
  });

  it("playlists list + export, with a 404 for an unknown playlist and 502 on failure", async () => {
    sp.listMyPlaylistsPage.mockResolvedValueOnce({ playlists: [], total: 0, hasMore: false, recentIds: [] });
    const list = await fetch(`${app.base}/api/spotify/playlists?offset=0&limit=10`, { headers: { Cookie: cookie } });
    expect(list.status).toBe(200);

    sp.getPlaylistExport.mockResolvedValueOnce({ id: "p", name: "n", owner: "o", coverUrl: null, tracks: [] });
    const exp = await fetch(`${app.base}/api/spotify/playlists/p`, { headers: { Cookie: cookie } });
    expect((await exp.json()).id).toBe("p");

    sp.getPlaylistExport.mockRejectedValueOnce(new Error("playlist_not_found"));
    const missing = await fetch(`${app.base}/api/spotify/playlists/x`, { headers: { Cookie: cookie } });
    expect(missing.status).toBe(404);

    sp.getPlaylistExport.mockRejectedValueOnce(new Error("spotify_500"));
    const err = await fetch(`${app.base}/api/spotify/playlists/y`, { headers: { Cookie: cookie } });
    expect(err.status).toBe(502);
  });

  it("now-playing returns the mapped payload", async () => {
    sp.getNowPlaying.mockResolvedValueOnce({ state: "none" });
    const res = await fetch(`${app.base}/api/spotify/now-playing`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(sp.toNowPlayingPayload).toHaveBeenCalled();
  });

  it("streams the current state over SSE", async () => {
    sp.getNowPlaying.mockResolvedValue({ state: "none" });
    const data = await readFirstSSE(`${app.base}/api/spotify/now-playing/stream`, cookie);
    expect(data).toContain("payload");
  });

  it("debug is available in dev but 404s in production", async () => {
    sp.getDebugInfo.mockResolvedValueOnce({ connected: true });
    const dev = await fetch(`${app.base}/api/spotify/debug`, { headers: { Cookie: cookie } });
    expect(dev.status).toBe(200);

    vi.stubEnv("NODE_ENV", "production");
    const prod = await fetch(`${app.base}/api/spotify/debug`, { headers: { Cookie: cookie } });
    expect(prod.status).toBe(404);
  });
});

// --- lastfm routes ---------------------------------------------------------

describe("lastfm routes", () => {
  it("connect: 400 on empty input, 400 on invalid username, 200 on success", async () => {
    const empty = await fetch(`${app.base}/api/lastfm/connect`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);

    lf.verifyAndConnect.mockRejectedValueOnce(new Error("invalid_username"));
    const bad = await fetch(`${app.base}/api/lastfm/connect`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "!!" }),
    });
    expect(bad.status).toBe(400);

    lf.verifyAndConnect.mockResolvedValueOnce("Erik");
    const ok = await fetch(`${app.base}/api/lastfm/connect`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "erik" }),
    });
    expect(await ok.json()).toEqual({ username: "Erik" });
  });

  it("disconnect 204, me profile, now-playing payload, and error mapping", async () => {
    const dc = await fetch(`${app.base}/api/lastfm/disconnect`, { method: "POST", headers: { Cookie: cookie } });
    expect(dc.status).toBe(204);

    lf.getProfile.mockResolvedValueOnce({ username: "Erik" });
    const me = await fetch(`${app.base}/api/lastfm/me`, { headers: { Cookie: cookie } });
    expect((await me.json()).username).toBe("Erik");

    lf.getNowPlaying.mockResolvedValueOnce({ state: "none" });
    const np = await fetch(`${app.base}/api/lastfm/now-playing`, { headers: { Cookie: cookie } });
    expect(np.status).toBe(200);

    lf.getProfile.mockRejectedValueOnce(new Error("not_connected"));
    const nc = await fetch(`${app.base}/api/lastfm/me`, { headers: { Cookie: cookie } });
    expect(nc.status).toBe(409);
  });

  it("streams over SSE", async () => {
    lf.getNowPlaying.mockResolvedValue({ state: "none" });
    const data = await readFirstSSE(`${app.base}/api/lastfm/now-playing/stream`, cookie);
    expect(data).toContain("payload");
  });
});
