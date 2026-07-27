import { prisma } from "../../db.js";
import {
  type CurrentTrack,
  type NowPlayingResult,
  toNowPlayingPayload,
} from "../spotify/spotify.service.js";

// ---------------------------------------------------------------------------
// Last.fm context logic. Unlike Spotify there's no OAuth: read-only user data
// needs only our app API key + the user's username. So "connecting" just stores
// a verified username (no tokens, no refresh, no expiry). We reuse Spotify's
// now-playing payload shape so the frontend Current Song mode is provider-blind.
//
// Public:   isConfigured, isLastfmConnected, getUsername, parseUsername,
//           verifyAndConnect, disconnect, getProfile, getNowPlaying,
//           toNowPlayingPayload (re-exported)
// ---------------------------------------------------------------------------

const PROVIDER = "lastfm";
const API_BASE = "https://ws.audioscrobbler.com/2.0/";
const API_KEY = process.env.LASTFM_API_KEY;

export function isConfigured(): boolean {
  return Boolean(API_KEY);
}

/** Accepts a bare username OR a last.fm profile link (last.fm/user/<name>). */
export function parseUsername(input: string): string | null {
  const s = input.trim();
  const linked = s.match(/last\.fm\/user\/([^/?#\s]+)/i);
  const raw = linked ? decodeURIComponent(linked[1]) : s;
  return /^[a-zA-Z0-9_-]{2,30}$/.test(raw) ? raw : null;
}

interface LfmImage {
  "#text": string;
  size: string;
}
interface LfmTrack {
  name?: string;
  artist?: { "#text"?: string; name?: string };
  album?: { "#text"?: string };
  image?: LfmImage[];
  "@attr"?: { nowplaying?: string };
}

function bestImage(images?: LfmImage[]): string | null {
  if (!images?.length) return null;
  for (const size of ["extralarge", "large", "medium", "small"]) {
    const hit = images.find((i) => i.size === size && i["#text"]);
    if (hit) return hit["#text"];
  }
  return images.find((i) => i["#text"])?.["#text"] ?? null;
}

/** GET a Last.fm read method as JSON. Last.fm returns HTTP 200 with an `error`
 *  code in the body for failures (e.g. 6 = unknown user), so we check both. */
async function lastfmGet<T>(
  method: string,
  params: Record<string, string>,
): Promise<T> {
  if (!API_KEY) throw new Error("not_configured");
  const qs = new URLSearchParams({
    method,
    api_key: API_KEY,
    format: "json",
    ...params,
  });
  const res = await fetch(`${API_BASE}?${qs.toString()}`, {
    headers: { "User-Agent": "MusicStreamingTools/1.0" },
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: number;
    message?: string;
  };
  if (!res.ok || data.error) {
    if (data.error === 6) throw new Error("user_not_found");
    console.error(`[lastfm] ${method} failed:`, res.status, data.error, data.message);
    throw new Error("lastfm_request_failed");
  }
  return data;
}

function getConnection(userId: number) {
  return prisma.connection.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
  });
}

export async function isLastfmConnected(userId: number): Promise<boolean> {
  return (await getConnection(userId)) !== null;
}

export async function getUsername(userId: number): Promise<string | null> {
  return (await getConnection(userId))?.accountName ?? null;
}

// --- Connect / disconnect -------------------------------------------------

interface UserInfoResp {
  user?: {
    name?: string;
    realname?: string;
    playcount?: string;
    url?: string;
    image?: LfmImage[];
  };
}

/** Verifies the username/link exists via user.getInfo, then stores the
 *  connection. Returns the canonical username Last.fm reports. */
export async function verifyAndConnect(
  userId: number,
  rawInput: string,
): Promise<string> {
  const username = parseUsername(rawInput);
  if (!username) throw new Error("invalid_username");
  const info = await lastfmGet<UserInfoResp>("user.getInfo", { user: username });
  const canonical = info.user?.name;
  if (!canonical) throw new Error("user_not_found");
  // Token columns are unused for Last.fm; fill with harmless placeholders.
  await prisma.connection.upsert({
    where: { userId_provider: { userId, provider: PROVIDER } },
    create: {
      userId,
      provider: PROVIDER,
      accessToken: "",
      refreshToken: "",
      expiresAt: new Date(0),
      scopes: "",
      accountName: canonical,
    },
    update: { accountName: canonical },
  });
  return canonical;
}

export async function disconnect(userId: number): Promise<void> {
  await prisma.connection.deleteMany({ where: { userId, provider: PROVIDER } });
}

// --- Profile --------------------------------------------------------------

export interface LastfmProfile {
  username: string;
  realname: string | null;
  playcount: number | null;
  url: string | null;
  imageUrl: string | null;
}

export async function getProfile(userId: number): Promise<LastfmProfile> {
  const username = await getUsername(userId);
  if (!username) throw new Error("not_connected");
  const info = await lastfmGet<UserInfoResp>("user.getInfo", { user: username });
  const u = info.user ?? {};
  return {
    username: u.name ?? username,
    realname: u.realname?.trim() ? u.realname : null,
    playcount: u.playcount ? Number(u.playcount) : null,
    url: u.url ?? null,
    imageUrl: bestImage(u.image),
  };
}

// --- Now playing ----------------------------------------------------------

interface RecentTracksResp {
  recenttracks?: { track?: LfmTrack | LfmTrack[] };
}

function toCurrentTrack(t: LfmTrack): CurrentTrack {
  return {
    artist: t.artist?.["#text"] || t.artist?.name || "Unknown artist",
    title: t.name || "Unknown title",
    album: t.album?.["#text"] || "",
    coverUrl: bestImage(t.image),
  };
}

/** Prefers the live "nowplaying" scrobble; if nothing is playing live, falls
 *  back to the most recent completed scrobble. `live` tells the two apart so the
 *  UI can label it. Requests 2 tracks so a completed one is always present. */
export async function getNowPlaying(userId: number): Promise<NowPlayingResult> {
  const username = await getUsername(userId);
  if (!username) throw new Error("not_connected");
  const data = await lastfmGet<RecentTracksResp>("user.getRecentTracks", {
    user: username,
    limit: "2",
  });
  const raw = data.recenttracks?.track;
  const tracks = Array.isArray(raw) ? raw : raw ? [raw] : [];

  const liveTrack = tracks.find((t) => t?.["@attr"]?.nowplaying === "true");
  if (liveTrack) {
    return { state: "track", track: toCurrentTrack(liveTrack), live: true };
  }
  const recent = tracks.find((t) => t?.["@attr"]?.nowplaying !== "true");
  if (!recent) return { state: "none" };
  return { state: "track", track: toCurrentTrack(recent), live: false };
}

export { toNowPlayingPayload };
