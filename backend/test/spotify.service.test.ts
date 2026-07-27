import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { jsonResponse, noContent, textResponse, mockFetchSequence } from "./_helpers";

// Mock the Prisma client the service imports — no real DB, no network.
vi.mock("../src/db", () => ({
  prisma: {
    connection: {
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "../src/db";
import { encryptSecret } from "../src/crypto";
import * as spotify from "../src/modules/spotify/spotify.service";

const conn = prisma.connection as unknown as {
  findUnique: Mock;
  update: Mock;
  upsert: Mock;
  deleteMany: Mock;
};

const USER = 1;

/** A stored connection whose access token is still valid (no refresh needed). */
function validConnection() {
  return {
    userId: USER,
    provider: "spotify",
    accessToken: encryptSecret("valid-access-token"),
    refreshToken: encryptSecret("stored-refresh-token"),
    expiresAt: new Date(Date.now() + 3_600_000), // 1h ahead
    scopes: "user-read-currently-playing",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  conn.findUnique.mockResolvedValue(validConnection());
  conn.update.mockResolvedValue({});
  conn.upsert.mockResolvedValue({});
  conn.deleteMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- pure helpers ----------------------------------------------------------

describe("spotify: pure helpers", () => {
  it("isConfigured() is true when client id + secret are set", () => {
    expect(spotify.isConfigured()).toBe(true);
  });

  it("toNowPlayingPayload maps every NowPlaying state", () => {
    expect(spotify.toNowPlayingPayload({ state: "none" })).toEqual({ playing: false });
    expect(spotify.toNowPlayingPayload({ state: "unsupported", type: "episode" })).toEqual({
      playing: true,
      supported: false,
      type: "episode",
    });
    const track = { artist: "A", title: "T", album: "Al", coverUrl: null };
    expect(spotify.toNowPlayingPayload({ state: "track", track })).toMatchObject({
      playing: true,
      supported: true,
      type: "track",
      live: true,
      artist: "A",
    });
    expect(
      spotify.toNowPlayingPayload({ state: "track", track, live: false }),
    ).toMatchObject({ live: false });
  });

  it("beginConnect issues a CSRF state that isValidAuthState accepts, then clears", () => {
    const url = spotify.beginConnect(USER);
    expect(url).toContain("https://accounts.spotify.com/authorize");
    expect(url).toContain("client_id=test-client-id");
    const state = new URL(url).searchParams.get("state")!;
    expect(spotify.isValidAuthState(state, USER)).toBe(true);
    expect(spotify.isValidAuthState(state, 999)).toBe(false);
    spotify.clearAuthState(state);
    expect(spotify.isValidAuthState(state, USER)).toBe(false);
  });
});

// --- connection state ------------------------------------------------------

describe("spotify: connection state", () => {
  it("isSpotifyConnected reflects whether a row exists", async () => {
    conn.findUnique.mockResolvedValueOnce(validConnection());
    expect(await spotify.isSpotifyConnected(USER)).toBe(true);
    conn.findUnique.mockResolvedValueOnce(null);
    expect(await spotify.isSpotifyConnected(USER)).toBe(false);
  });

  it("disconnect deletes the connection row", async () => {
    await spotify.disconnect(USER);
    expect(conn.deleteMany).toHaveBeenCalledWith({ where: { userId: USER, provider: "spotify" } });
  });
});

// --- token handling --------------------------------------------------------

describe("spotify: getValidAccessToken", () => {
  it("throws not_connected when there is no connection", async () => {
    conn.findUnique.mockResolvedValueOnce(null);
    await expect(spotify.getValidAccessToken(USER)).rejects.toThrow("not_connected");
  });

  it("returns the stored token when it is still valid (no network)", async () => {
    const fetchMock = mockFetchSequence();
    const token = await spotify.getValidAccessToken(USER);
    expect(token).toBe("valid-access-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes and stores a new token when the stored one is about to expire", async () => {
    conn.findUnique.mockResolvedValueOnce({
      ...validConnection(),
      expiresAt: new Date(Date.now() + 1_000), // within the 60s skew window
    });
    mockFetchSequence(
      jsonResponse({ access_token: "fresh-token", expires_in: 3600, scope: "s" }),
    );
    const token = await spotify.getValidAccessToken(USER);
    expect(token).toBe("fresh-token");
    expect(conn.update).toHaveBeenCalledTimes(1);
  });

  it("throws refresh_failed when Spotify rejects the refresh", async () => {
    conn.findUnique.mockResolvedValueOnce({
      ...validConnection(),
      expiresAt: new Date(Date.now() - 1_000),
    });
    mockFetchSequence(jsonResponse({ error: "invalid_grant" }, 400));
    await expect(spotify.getValidAccessToken(USER)).rejects.toThrow("refresh_failed");
  });
});

// --- now playing -----------------------------------------------------------

describe("spotify: getNowPlaying", () => {
  const trackBody = {
    currently_playing_type: "track",
    item: { name: "Song", artists: [{ name: "Artist" }], album: { name: "Album", images: [{ url: "http://cover" }] } },
  };

  it("returns a live track when one is playing", async () => {
    mockFetchSequence(jsonResponse(trackBody));
    const r = await spotify.getNowPlaying(USER);
    expect(r).toMatchObject({ state: "track", live: true, track: { title: "Song", artist: "Artist" } });
  });

  it("flags episodes/ads as unsupported", async () => {
    mockFetchSequence(jsonResponse({ currently_playing_type: "episode", item: { name: "x" } }));
    expect(await spotify.getNowPlaying(USER)).toEqual({ state: "unsupported", type: "episode" });
  });

  it("falls back to recently-played on 204", async () => {
    mockFetchSequence(
      noContent(),
      jsonResponse({ items: [{ track: { name: "Old", artists: [{ name: "Past" }], album: { name: "A", images: [{ url: "c" }] } } }] }),
    );
    const r = await spotify.getNowPlaying(USER);
    expect(r).toMatchObject({ state: "track", live: false, track: { title: "Old" } });
  });

  it("returns none on 204 when there is no recent track either", async () => {
    mockFetchSequence(noContent(), jsonResponse({ items: [] }));
    expect(await spotify.getNowPlaying(USER)).toEqual({ state: "none" });
  });

  it("falls back to recently-played when the item is null", async () => {
    mockFetchSequence(jsonResponse({ item: null }), jsonResponse({ items: [] }));
    expect(await spotify.getNowPlaying(USER)).toEqual({ state: "none" });
  });

  it("throws on an unexpected Spotify error status", async () => {
    mockFetchSequence(textResponse("boom", 500));
    await expect(spotify.getNowPlaying(USER)).rejects.toThrow("spotify_500");
  });

  it("returns none when recently-played 403s (missing scope)", async () => {
    mockFetchSequence(noContent(), textResponse("forbidden", 403));
    expect(await spotify.getNowPlaying(USER)).toEqual({ state: "none" });
  });
});

// --- queue -----------------------------------------------------------------

describe("spotify: getQueue", () => {
  it("returns empty on 204", async () => {
    mockFetchSequence(noContent());
    expect(await spotify.getQueue(USER)).toEqual({ current: null, queue: [] });
  });

  it("normalizes the current track and filters non-track queue items", async () => {
    mockFetchSequence(
      jsonResponse({
        currently_playing: { type: "track", name: "Now", artists: [{ name: "A" }] },
        queue: [
          { type: "track", name: "Next", artists: [{ name: "B" }] },
          { type: "episode", name: "Podcast" },
        ],
      }),
    );
    const r = await spotify.getQueue(USER);
    expect(r.current).toMatchObject({ title: "Now" });
    expect(r.queue).toHaveLength(1);
    expect(r.queue[0]).toMatchObject({ title: "Next", artist: "B" });
  });

  it("throws on error status", async () => {
    mockFetchSequence(textResponse("err", 502));
    await expect(spotify.getQueue(USER)).rejects.toThrow("spotify_502");
  });
});

// --- playlists -------------------------------------------------------------

describe("spotify: playlists", () => {
  const page = (items: unknown[], next: string | null = null) => jsonResponse({ items, next });
  const pl = (id: string, name = id) => ({ id, name, owner: { display_name: "me" }, images: [{ url: "c" }], tracks: { total: 3 } });

  it("listMyPlaylists paginates and ranks recently-played first", async () => {
    mockFetchSequence(
      page([pl("p1"), pl("p2")], "http://next"),
      page([pl("p3")]),
      // recently-played: p3 then p1
      jsonResponse({
        items: [
          { context: { type: "playlist", uri: "spotify:playlist:p3" } },
          { context: { type: "playlist", uri: "spotify:playlist:p1" } },
          { context: { type: "album", uri: "spotify:album:x" } },
          { context: null },
        ],
      }),
    );
    const out = await spotify.listMyPlaylists(USER);
    expect(out.map((p) => p.id)).toEqual(["p3", "p1", "p2"]);
  });

  it("listMyPlaylists keeps library order when there is no play history", async () => {
    mockFetchSequence(page([pl("p1"), pl("p2")]), jsonResponse({ items: [] }));
    const out = await spotify.listMyPlaylists(USER);
    expect(out.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("getPlaylists maps to the compact entry shape", async () => {
    mockFetchSequence(page([pl("p1", "Mix")]), jsonResponse({ items: [] }));
    const out = await spotify.getPlaylists(USER, 5);
    expect(out[0]).toEqual({ title: "Mix", creator: "me", coverUrl: "c" });
  });

  it("listMyPlaylistsPage returns totals + recentIds on the first page", async () => {
    mockFetchSequence(
      jsonResponse({ items: [pl("p1")], total: 10, next: "http://next" }),
      jsonResponse({ items: [{ context: { type: "playlist", uri: "spotify:playlist:p1" } }] }),
    );
    const r = await spotify.listMyPlaylistsPage(USER, 0, 50);
    expect(r).toMatchObject({ total: 10, hasMore: true, recentIds: ["p1"] });
    expect(r.playlists[0].id).toBe("p1");
  });

  it("listMyPlaylistsPage skips the recent-ids fetch when offset > 0", async () => {
    const fetchMock = mockFetchSequence(jsonResponse({ items: [pl("p2")], total: 10, next: null }));
    const r = await spotify.listMyPlaylistsPage(USER, 50, 50);
    expect(r.recentIds).toEqual([]);
    expect(r.hasMore).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("listMyPlaylists throws on a hard error", async () => {
    mockFetchSequence(textResponse("nope", 500));
    await expect(spotify.listMyPlaylists(USER)).rejects.toThrow("spotify_500");
  });
});

// --- playlist export -------------------------------------------------------

describe("spotify: getPlaylistExport", () => {
  it("returns metadata + numbered tracks, skipping non-track items", async () => {
    mockFetchSequence(
      jsonResponse({ id: "pl", name: "My List", owner: { display_name: "me" }, images: [{ url: "c" }] }),
      jsonResponse({
        next: null,
        items: [
          { track: { type: "track", name: "One", artists: [{ name: "A" }, { name: "B" }] } },
          { track: null },
          { track: { type: "episode", name: "Skip" } },
          { track: { type: "track", name: "Two", artists: [] } },
        ],
      }),
    );
    const r = await spotify.getPlaylistExport(USER, "pl");
    expect(r).toMatchObject({ id: "pl", name: "My List", owner: "me" });
    expect(r.tracks).toEqual([
      { position: 1, artist: "A, B", title: "One" },
      { position: 2, artist: "Unknown artist", title: "Two" },
    ]);
  });

  it("throws playlist_not_found on a 404 metadata response", async () => {
    mockFetchSequence(jsonResponse({ error: "nope" }, 404));
    await expect(spotify.getPlaylistExport(USER, "missing")).rejects.toThrow("playlist_not_found");
  });

  it("throws when the tracks request fails", async () => {
    mockFetchSequence(
      jsonResponse({ id: "pl", name: "X" }),
      textResponse("err", 500),
    );
    await expect(spotify.getPlaylistExport(USER, "pl")).rejects.toThrow("spotify_500");
  });
});

// --- profile / debug / oauth ----------------------------------------------

describe("spotify: profile, debug, oauth", () => {
  it("getProfile mirrors the upstream status and body", async () => {
    mockFetchSequence(jsonResponse({ display_name: "Erik" }));
    expect(await spotify.getProfile(USER)).toMatchObject({ ok: true, status: 200, data: { display_name: "Erik" } });

    mockFetchSequence(textResponse("no", 401));
    expect(await spotify.getProfile(USER)).toMatchObject({ ok: false, status: 401, data: null });
  });

  it("getDebugInfo aggregates the connection scopes and raw endpoints", async () => {
    mockFetchSequence(
      jsonResponse({ is_playing: true }),
      jsonResponse({ device: { id: "d" } }),
    );
    const r = await spotify.getDebugInfo(USER);
    expect(r.connected).toBe(true);
    expect(r.grantedScopes).toBe("user-read-currently-playing");
    expect(r.currentlyPlaying.status).toBe(200);
  });

  it("exchangeCodeAndStore upserts on success", async () => {
    mockFetchSequence(
      jsonResponse({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: "s" }),
    );
    await spotify.exchangeCodeAndStore(USER, "auth-code");
    expect(conn.upsert).toHaveBeenCalledTimes(1);
  });

  it("exchangeCodeAndStore throws when the code exchange fails", async () => {
    mockFetchSequence(textResponse("bad_code", 400));
    await expect(spotify.exchangeCodeAndStore(USER, "bad")).rejects.toThrow("token_exchange_failed");
    expect(conn.upsert).not.toHaveBeenCalled();
  });
});

// Extra edge branches for the recently-played fallbacks and playlist ranking.
describe("spotify: recently-played edge branches", () => {
  it("getNowPlaying → none when a recent item has no track object", async () => {
    mockFetchSequence(noContent(), jsonResponse({ items: [{}] }));
    expect(await spotify.getNowPlaying(USER)).toEqual({ state: "none" });
  });

  it("getNowPlaying → none when recently-played errors with a non-403 status", async () => {
    mockFetchSequence(noContent(), textResponse("boom", 500));
    expect(await spotify.getNowPlaying(USER)).toEqual({ state: "none" });
  });

  it("listMyPlaylists ignores a recently-played id that isn't in the library", async () => {
    mockFetchSequence(
      jsonResponse({ items: [{ id: "p1", name: "P1", owner: { display_name: "me" }, tracks: { total: 1 } }], next: null }),
      jsonResponse({
        items: [
          { context: { type: "playlist", uri: "spotify:playlist:ghost" } }, // not owned
          { context: { type: "playlist", uri: "spotify:playlist:p1" } },
        ],
      }),
    );
    const out = await spotify.listMyPlaylists(USER);
    expect(out.map((p) => p.id)).toEqual(["p1"]);
  });

  it("listMyPlaylists tolerates a failing recently-played request (keeps order)", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [{ id: "p1", name: "P1", owner: { display_name: "me" }, tracks: { total: 1 } }], next: null }),
    );
    fetchMock.mockRejectedValueOnce(new Error("network")); // getRecentlyPlayedPlaylistIds catch → []
    vi.stubGlobal("fetch", fetchMock);
    const out = await spotify.listMyPlaylists(USER);
    expect(out.map((p) => p.id)).toEqual(["p1"]);
  });
});
