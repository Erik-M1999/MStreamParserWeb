import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { jsonResponse } from "./_helpers";

// Mock the Spotify service that rendering.service depends on (the one cross-module
// edge). fillTemplate + resvg run for real.
vi.mock("../src/modules/spotify/spotify.service", () => ({
  getValidAccessToken: vi.fn(),
  getNowPlaying: vi.fn(),
  getQueue: vi.fn(),
  getPlaylists: vi.fn(),
  // Real implementation: rendering only needs to tell an expired grant apart
  // from "never connected" so it can show the right message.
  REAUTH_REQUIRED: "spotify_reauth_required",
  isReauthRequired: (err: unknown) =>
    err instanceof Error && err.message === "spotify_reauth_required",
}));

import * as spotify from "../src/modules/spotify/spotify.service";
import { render, svgToPng } from "../src/modules/rendering/rendering.service";

const mocked = spotify as unknown as {
  getValidAccessToken: Mock;
  getNowPlaying: Mock;
  getQueue: Mock;
  getPlaylists: Mock;
};

/** Reads the pixel width out of a PNG's IHDR chunk (bytes 16–19, big-endian). */
function pngWidth(buf: Buffer): number {
  expect(buf.subarray(1, 4).toString()).toBe("PNG"); // magic
  return buf.readUInt32BE(16);
}

const LANDSCAPE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#111"/></svg>`;
const PORTRAIT = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="200"><rect width="100" height="200" fill="#111"/></svg>`;

const TEMPLATE = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
  <text template-id="title">OLD</text>
  <text template-id="artist">OLD</text>
  <text template-id="current_title">OLD</text>
  <text template-id="title2">OLD</text>
  <rect template-id="cover" x="0" y="0" width="5" height="5"/>
</svg>`;

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getValidAccessToken.mockResolvedValue("token"); // connected by default
});

afterEach(() => vi.unstubAllGlobals());

describe("svgToPng", () => {
  it("renders at natural size when no target is given", () => {
    expect(pngWidth(svgToPng(LANDSCAPE))).toBe(200);
  });

  it("downscales the longest side of a landscape SVG", () => {
    expect(pngWidth(svgToPng(LANDSCAPE, 100))).toBe(100);
  });

  it("downscales a portrait SVG by its (taller) height", () => {
    // longest side (height) -> 100, so width scales to 50
    expect(pngWidth(svgToPng(PORTRAIT, 100))).toBe(50);
  });

  it("never upscales past the natural size", () => {
    expect(pngWidth(svgToPng(LANDSCAPE, 5000))).toBe(200);
  });

  it("treats 0 as 'natural size'", () => {
    expect(pngWidth(svgToPng(LANDSCAPE, 0))).toBe(200);
  });
});

describe("render", () => {
  it("rejects an empty template with 400", async () => {
    await expect(render(1, "   ", "current-song")).rejects.toMatchObject({ status: 400 });
  });

  it("returns 409 when Spotify is not connected", async () => {
    mocked.getValidAccessToken.mockRejectedValueOnce(new Error("not_connected"));
    await expect(render(1, TEMPLATE, "current-song")).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/Connect your Spotify account/i),
    });
  });

  // An expired grant (Spotify's 6-month refresh-token lifetime) must not read as
  // "you were never connected" — the user has to re-authorize.
  it("returns 409 telling the user to reconnect when the grant has expired", async () => {
    mocked.getValidAccessToken.mockRejectedValueOnce(
      new Error("spotify_reauth_required"),
    );
    await expect(render(1, TEMPLATE, "current-song")).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/expired.*[Rr]econnect/s),
    });
  });

  it("fills a current-song template with the playing track (and inlines the cover)", async () => {
    mocked.getNowPlaying.mockResolvedValueOnce({
      state: "track",
      track: { artist: "Queen", title: "Bohemian Rhapsody", album: "A", coverUrl: "https://i.scdn.co/image/ab67616d0000b273cover" },
    });
    // Cover fetch -> a tiny image, inlined as a data URI.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } })),
    );
    const out = await render(1, TEMPLATE, "current-song");
    expect(out).toContain("Bohemian Rhapsody");
    expect(out).toContain("Queen");
    expect(out).toContain("data:image/jpeg;base64,");
  });

  it("returns 409 when nothing is playing (current-song)", async () => {
    mocked.getNowPlaying.mockResolvedValueOnce({ state: "none" });
    await expect(render(1, TEMPLATE, "current-song")).rejects.toMatchObject({ status: 409 });
  });

  it("returns 409 for an unsupported item (podcast/ad)", async () => {
    mocked.getNowPlaying.mockResolvedValueOnce({ state: "unsupported", type: "episode" });
    await expect(render(1, TEMPLATE, "current-song")).rejects.toMatchObject({ status: 409 });
  });

  it("maps a non-conflict Spotify failure to 502", async () => {
    mocked.getNowPlaying.mockRejectedValueOnce(new Error("spotify_500"));
    await expect(render(1, TEMPLATE, "current-song")).rejects.toMatchObject({ status: 502 });
  });

  it("fills a queue template", async () => {
    mocked.getQueue.mockResolvedValueOnce({
      current: { artist: "A", title: "Now", album: "", coverUrl: null },
      queue: [{ artist: "B", title: "Next", album: "", coverUrl: null }],
    });
    const out = await render(1, TEMPLATE, "queue");
    expect(out).toContain("Now");
  });

  it("returns 409 for an empty queue", async () => {
    mocked.getQueue.mockResolvedValueOnce({ current: null, queue: [] });
    await expect(render(1, TEMPLATE, "queue")).rejects.toMatchObject({ status: 409 });
  });

  it("fills a playlist template", async () => {
    mocked.getPlaylists.mockResolvedValueOnce([
      { title: "Chill", creator: "me", coverUrl: null },
    ]);
    const out = await render(1, TEMPLATE, "playlist");
    expect(out).toContain("Chill");
  });

  it("returns 409 when there are no playlists", async () => {
    mocked.getPlaylists.mockResolvedValueOnce([]);
    await expect(render(1, TEMPLATE, "playlist")).rejects.toMatchObject({ status: 409 });
  });

  it("returns 409 for an unknown mode", async () => {
    await expect(render(1, TEMPLATE, "bogus")).rejects.toMatchObject({ status: 409 });
  });

  it("returns 400 when no slots match the template", async () => {
    mocked.getNowPlaying.mockResolvedValueOnce({
      state: "track",
      track: { artist: "A", title: "T", album: "", coverUrl: null },
    });
    const noSlots = `<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`;
    await expect(render(1, noSlots, "current-song")).rejects.toMatchObject({ status: 400 });
  });

  // Cover URLs come from the provider's API response, not from us. If one ever
  // points somewhere unexpected, we must not fetch it and base64 the reply into
  // the SVG we hand back — that would be a readable SSRF.
  it("refuses to fetch a cover from a host outside the provider CDNs", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(Buffer.from("internal secret"), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    for (const coverUrl of [
      "http://169.254.169.254/latest/meta-data/", // cloud metadata
      "https://evil.example/pixel.jpg", // attacker-controlled host
      "http://i.scdn.co/image/x", // right host, but plaintext http
      "file:///etc/passwd",
    ]) {
      mocked.getNowPlaying.mockResolvedValueOnce({
        state: "track",
        track: { artist: "A", title: "T", album: "", coverUrl },
      });
      const out = await render(1, TEMPLATE, "current-song");
      expect(out).toContain("T"); // text still fills; the cover is just skipped
      expect(out).not.toContain("data:");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts covers from the Spotify and Last.fm CDNs", async () => {
    for (const coverUrl of [
      "https://i.scdn.co/image/ab67616d00001e02",
      "https://mosaic.scdn.co/640/abc",
      "https://lastfm.freetls.fastly.net/i/u/300x300/abc.png",
    ]) {
      mocked.getNowPlaying.mockResolvedValueOnce({
        state: "track",
        track: { artist: "A", title: "T", album: "", coverUrl },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(Buffer.from([1, 2, 3]), {
              status: 200,
              headers: { "content-type": "image/jpeg" },
            }),
        ),
      );
      const out = await render(1, TEMPLATE, "current-song");
      expect(out).toContain("data:image/jpeg;base64,");
    }
  });

  it("degrades gracefully when the cover download fails", async () => {
    mocked.getNowPlaying.mockResolvedValueOnce({
      state: "track",
      track: { artist: "A", title: "T", album: "", coverUrl: "https://i.scdn.co/image/ab67616d0000b273cover" },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const out = await render(1, TEMPLATE, "current-song");
    expect(out).toContain("T"); // text still filled; cover simply skipped
    expect(out).not.toContain("data:");
  });
});
