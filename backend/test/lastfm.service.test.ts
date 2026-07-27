import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { jsonResponse, mockFetchSequence } from "./_helpers";

vi.mock("../src/db", () => ({
  prisma: {
    connection: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "../src/db";
import * as lastfm from "../src/modules/lastfm/lastfm.service";

const conn = prisma.connection as unknown as {
  findUnique: Mock;
  upsert: Mock;
  deleteMany: Mock;
};

const USER = 1;

beforeEach(() => {
  vi.clearAllMocks();
  conn.findUnique.mockResolvedValue({ accountName: "erik" });
  conn.upsert.mockResolvedValue({});
  conn.deleteMany.mockResolvedValue({ count: 1 });
});

afterEach(() => vi.unstubAllGlobals());

describe("lastfm: parseUsername", () => {
  it("accepts a bare username", () => {
    expect(lastfm.parseUsername("erik_99")).toBe("erik_99");
  });
  it("extracts the name from a profile link", () => {
    expect(lastfm.parseUsername("https://www.last.fm/user/SomeUser?foo=1")).toBe("SomeUser");
  });
  it("rejects too-short, too-long, or invalid names", () => {
    expect(lastfm.parseUsername("a")).toBeNull();
    expect(lastfm.parseUsername("x".repeat(31))).toBeNull();
    expect(lastfm.parseUsername("bad name!")).toBeNull();
  });
  it("isConfigured() is true when the API key is set", () => {
    expect(lastfm.isConfigured()).toBe(true);
  });
});

describe("lastfm: connection state", () => {
  it("isLastfmConnected + getUsername read the stored account", async () => {
    expect(await lastfm.isLastfmConnected(USER)).toBe(true);
    expect(await lastfm.getUsername(USER)).toBe("erik");

    conn.findUnique.mockResolvedValueOnce(null);
    expect(await lastfm.isLastfmConnected(USER)).toBe(false);
  });

  it("disconnect removes the connection", async () => {
    await lastfm.disconnect(USER);
    expect(conn.deleteMany).toHaveBeenCalledWith({ where: { userId: USER, provider: "lastfm" } });
  });
});

describe("lastfm: verifyAndConnect", () => {
  it("rejects an invalid username before any request", async () => {
    await expect(lastfm.verifyAndConnect(USER, "!!")).rejects.toThrow("invalid_username");
    expect(conn.upsert).not.toHaveBeenCalled();
  });

  it("stores the canonical username on success", async () => {
    mockFetchSequence(jsonResponse({ user: { name: "RealErik" } }));
    const name = await lastfm.verifyAndConnect(USER, "realerik");
    expect(name).toBe("RealErik");
    expect(conn.upsert).toHaveBeenCalledTimes(1);
  });

  it("throws user_not_found when Last.fm returns error code 6", async () => {
    mockFetchSequence(jsonResponse({ error: 6, message: "User not found" }));
    await expect(lastfm.verifyAndConnect(USER, "ghost")).rejects.toThrow("user_not_found");
  });

  it("throws lastfm_request_failed on a non-6 API error", async () => {
    mockFetchSequence(jsonResponse({ error: 10, message: "Invalid API key" }));
    await expect(lastfm.verifyAndConnect(USER, "someone")).rejects.toThrow("lastfm_request_failed");
  });
});

describe("lastfm: getProfile", () => {
  it("throws not_connected without a stored username", async () => {
    conn.findUnique.mockResolvedValueOnce(null);
    await expect(lastfm.getProfile(USER)).rejects.toThrow("not_connected");
  });

  it("maps the profile fields and picks the best image", async () => {
    mockFetchSequence(
      jsonResponse({
        user: {
          name: "Erik",
          realname: "  Erik M  ",
          playcount: "4210",
          url: "http://last.fm/user/Erik",
          image: [
            { "#text": "small.jpg", size: "small" },
            { "#text": "xl.jpg", size: "extralarge" },
          ],
        },
      }),
    );
    const p = await lastfm.getProfile(USER);
    expect(p).toEqual({
      username: "Erik",
      realname: "  Erik M  ",
      playcount: 4210,
      url: "http://last.fm/user/Erik",
      imageUrl: "xl.jpg",
    });
  });

  it("nulls a blank realname and missing playcount", async () => {
    mockFetchSequence(jsonResponse({ user: { name: "Erik", realname: "   " } }));
    const p = await lastfm.getProfile(USER);
    expect(p.realname).toBeNull();
    expect(p.playcount).toBeNull();
    expect(p.imageUrl).toBeNull();
  });
});

describe("lastfm: getNowPlaying", () => {
  it("throws not_connected without a username", async () => {
    conn.findUnique.mockResolvedValueOnce(null);
    await expect(lastfm.getNowPlaying(USER)).rejects.toThrow("not_connected");
  });

  it("prefers the live now-playing scrobble", async () => {
    mockFetchSequence(
      jsonResponse({
        recenttracks: {
          track: [
            { name: "Live", artist: { "#text": "A" }, album: { "#text": "Al" }, image: [{ "#text": "c.jpg", size: "large" }], "@attr": { nowplaying: "true" } },
            { name: "Old", artist: { "#text": "B" } },
          ],
        },
      }),
    );
    const r = await lastfm.getNowPlaying(USER);
    expect(r).toMatchObject({ state: "track", live: true, track: { title: "Live", artist: "A", coverUrl: "c.jpg" } });
  });

  it("falls back to the most recent completed scrobble", async () => {
    mockFetchSequence(
      jsonResponse({ recenttracks: { track: [{ name: "Recent", artist: { name: "C" } }] } }),
    );
    const r = await lastfm.getNowPlaying(USER);
    expect(r).toMatchObject({ state: "track", live: false, track: { title: "Recent", artist: "C" } });
  });

  it("returns none when there are no tracks", async () => {
    mockFetchSequence(jsonResponse({ recenttracks: { track: [] } }));
    expect(await lastfm.getNowPlaying(USER)).toEqual({ state: "none" });
  });

  it("handles a single (non-array) track object", async () => {
    mockFetchSequence(
      jsonResponse({ recenttracks: { track: { name: "Solo", artist: { "#text": "D" }, "@attr": { nowplaying: "true" } } } }),
    );
    const r = await lastfm.getNowPlaying(USER);
    expect(r).toMatchObject({ state: "track", live: true, track: { title: "Solo" } });
  });
});
