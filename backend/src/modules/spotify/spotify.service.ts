import crypto from "node:crypto";
import { prisma } from "../../db.js";
import { encryptSecret, decryptSecret } from "../../crypto.js";

// ---------------------------------------------------------------------------
// Spotify context logic: OAuth (Authorization Code flow), token storage/refresh
// (encrypted at rest), and the playback reads (now-playing / queue / playlists).
// Per-user — a Connection row keyed by userId; the client secret stays here.
//
// Public:   isConfigured, isSpotifyConnected, getValidAccessToken,
//           getNowPlaying, getQueue, getPlaylists, toNowPlayingPayload,
//           getProfile, getDebugInfo, beginConnect, isValidAuthState,
//           clearAuthState, exchangeCodeAndStore, SCOPES
// Internal: getConnection, refreshAndStore, normTrack, rawSpotifyGet, …
// ---------------------------------------------------------------------------

const PROVIDER = "spotify";

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI ??
  "http://127.0.0.1:3000/api/auth/spotify/callback";

export const SCOPES =
  "user-read-private user-read-email user-read-currently-playing user-read-playback-state playlist-read-private";

// Pending OAuth states: state -> userId (CSRF guard + per-user binding).
const pendingStates = new Map<string, number>();

export function isConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}
function basicAuthHeader(): string {
  return "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
}

export interface CurrentTrack {
  artist: string;
  title: string;
  album: string;
  coverUrl: string | null;
}

interface CurrentlyPlayingResponse {
  currently_playing_type?: string; // "track" | "episode" | "ad" | "unknown"
  item: {
    name: string;
    artists?: { name: string }[];
    album?: { name: string; images: { url: string }[] };
  } | null;
}

export type NowPlayingResult =
  | { state: "none" }
  | { state: "unsupported"; type: string }
  | { state: "track"; track: CurrentTrack };

function getConnection(userId: number) {
  return prisma.connection.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
  });
}

/** Whether the given user has a Spotify connection. */
export async function isSpotifyConnected(userId: number): Promise<boolean> {
  return (await getConnection(userId)) !== null;
}

async function refreshAndStore(userId: number, refreshToken: string): Promise<string> {
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error("refresh_failed");
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
  };
  await prisma.connection.update({
    where: { userId_provider: { userId, provider: PROVIDER } },
    data: {
      accessToken: encryptSecret(data.access_token),
      // Spotify may omit a new refresh token; keep the existing one.
      // `refreshToken` here is already decrypted (the caller decrypts it).
      refreshToken: encryptSecret(data.refresh_token ?? refreshToken),
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      ...(data.scope ? { scopes: data.scope } : {}),
    },
  });
  return data.access_token;
}

/** A usable access token for the user, refreshing it if it's about to expire. */
export async function getValidAccessToken(userId: number): Promise<string> {
  const conn = await getConnection(userId);
  if (!conn) throw new Error("not_connected");
  if (Date.now() >= conn.expiresAt.getTime() - 60_000) {
    return refreshAndStore(userId, decryptSecret(conn.refreshToken));
  }
  return decryptSecret(conn.accessToken);
}

export async function getNowPlaying(userId: number): Promise<NowPlayingResult> {
  const token = await getValidAccessToken(userId);
  const res = await fetch(`${SPOTIFY_API_BASE}/me/player/currently-playing`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204) return { state: "none" };
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[spotify] currently-playing ${res.status}:`, detail);
    throw new Error(`spotify_${res.status}`);
  }
  const data = (await res.json()) as CurrentlyPlayingResponse;
  if (!data.item) return { state: "none" };
  if (data.currently_playing_type && data.currently_playing_type !== "track") {
    return { state: "unsupported", type: data.currently_playing_type };
  }
  const item = data.item;
  return {
    state: "track",
    track: {
      artist: item.artists?.[0]?.name ?? "Unknown artist",
      title: item.name ?? "Unknown title",
      album: item.album?.name ?? "",
      coverUrl: item.album?.images?.[0]?.url ?? null,
    },
  };
}

interface QueueItem {
  type?: string;
  name?: string;
  artists?: { name: string }[];
  album?: { name?: string; images?: { url: string }[] };
}

export interface QueueResult {
  current: CurrentTrack | null;
  queue: CurrentTrack[];
}

function normTrack(item: QueueItem | null): CurrentTrack | null {
  if (!item) return null;
  return {
    artist: item.artists?.[0]?.name ?? "Unknown artist",
    title: item.name ?? "Unknown title",
    album: item.album?.name ?? "",
    coverUrl: item.album?.images?.[0]?.url ?? null,
  };
}

export async function getQueue(userId: number): Promise<QueueResult> {
  const token = await getValidAccessToken(userId);
  const res = await fetch(`${SPOTIFY_API_BASE}/me/player/queue`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204) return { current: null, queue: [] };
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[spotify] queue ${res.status}:`, detail);
    throw new Error(`spotify_${res.status}`);
  }
  const data = (await res.json()) as {
    currently_playing: QueueItem | null;
    queue: QueueItem[];
  };
  const queue = (data.queue ?? [])
    .filter((i) => i?.type === "track")
    .map(normTrack)
    .filter((t): t is CurrentTrack => t !== null);
  return { current: normTrack(data.currently_playing), queue };
}

export interface PlaylistEntry {
  title: string;
  creator: string;
  coverUrl: string | null;
}

export async function getPlaylists(userId: number, limit = 5): Promise<PlaylistEntry[]> {
  const token = await getValidAccessToken(userId);
  const res = await fetch(`${SPOTIFY_API_BASE}/me/playlists?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[spotify] playlists ${res.status}:`, detail);
    throw new Error(`spotify_${res.status}`);
  }
  const data = (await res.json()) as {
    items: {
      name?: string;
      owner?: { display_name?: string };
      images?: { url: string }[];
    }[];
  };
  return (data.items ?? []).map((p) => ({
    title: p?.name ?? "Untitled",
    creator: p?.owner?.display_name ?? "",
    coverUrl: p?.images?.[0]?.url ?? null,
  }));
}

// --- Playlist Extractor ---------------------------------------------------

export interface PlaylistSummary {
  id: string;
  name: string;
  owner: string;
  trackCount: number;
  coverUrl: string | null;
}

interface RawPlaylist {
  id?: string;
  name?: string;
  owner?: { display_name?: string };
  images?: { url: string }[];
  tracks?: { total?: number };
}

/** All of the user's saved/owned playlists, paginated to completion. */
export async function listMyPlaylists(userId: number): Promise<PlaylistSummary[]> {
  const token = await getValidAccessToken(userId);
  const out: PlaylistSummary[] = [];
  let url: string | null = `${SPOTIFY_API_BASE}/me/playlists?limit=50`;
  while (url) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[spotify] playlists ${res.status}:`, detail);
      throw new Error(`spotify_${res.status}`);
    }
    const data = (await res.json()) as { items: RawPlaylist[]; next: string | null };
    for (const p of data.items ?? []) {
      if (!p?.id) continue;
      out.push({
        id: p.id,
        name: p.name ?? "Untitled",
        owner: p.owner?.display_name ?? "",
        trackCount: p.tracks?.total ?? 0,
        coverUrl: p.images?.[0]?.url ?? null,
      });
    }
    url = data.next;
  }
  return out;
}

export interface ExportedTrack {
  position: number;
  artist: string;
  title: string;
}
export interface PlaylistExport {
  id: string;
  name: string;
  owner: string;
  tracks: ExportedTrack[];
}

/** A single playlist's tracks in its stored order, numbered for export.
 *  Works for any playlist the user's token can read (own or public). */
export async function getPlaylistExport(
  userId: number,
  playlistId: string,
): Promise<PlaylistExport> {
  const token = await getValidAccessToken(userId);
  const auth = { Authorization: `Bearer ${token}` };

  // Metadata (name/owner) for the filename + header.
  const metaRes = await fetch(
    `${SPOTIFY_API_BASE}/playlists/${playlistId}?fields=id,name,owner(display_name)`,
    { headers: auth },
  );
  if (metaRes.status === 404) throw new Error("playlist_not_found");
  if (!metaRes.ok) {
    const detail = await metaRes.text().catch(() => "");
    console.error(`[spotify] playlist meta ${metaRes.status}:`, detail);
    throw new Error(`spotify_${metaRes.status}`);
  }
  const meta = (await metaRes.json()) as {
    id?: string;
    name?: string;
    owner?: { display_name?: string };
  };

  // Tracks, paginated (100/page), preserving the playlist's custom order.
  const tracks: ExportedTrack[] = [];
  let position = 0;
  let url: string | null =
    `${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks` +
    `?limit=100&fields=next,items(track(type,name,artists(name)))`;
  while (url) {
    const res: Response = await fetch(url, { headers: auth });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[spotify] playlist tracks ${res.status}:`, detail);
      throw new Error(`spotify_${res.status}`);
    }
    const data = (await res.json()) as {
      next: string | null;
      items: {
        track: { type?: string; name?: string; artists?: { name: string }[] } | null;
      }[];
    };
    for (const item of data.items ?? []) {
      const tr = item?.track;
      // Skip removed entries and non-track items (e.g. podcast episodes).
      if (!tr || (tr.type && tr.type !== "track")) continue;
      const artist =
        (tr.artists ?? [])
          .map((a) => a.name)
          .filter(Boolean)
          .join(", ") || "Unknown artist";
      position += 1;
      tracks.push({ position, artist, title: tr.name ?? "Unknown title" });
    }
    url = data.next;
  }

  return {
    id: meta.id ?? playlistId,
    name: meta.name ?? "Playlist",
    owner: meta.owner?.display_name ?? "",
    tracks,
  };
}

/** The JSON shape the frontend's now-playing UI consumes (one source of truth
 *  for both the one-shot GET and the SSE stream). */
export function toNowPlayingPayload(np: NowPlayingResult) {
  if (np.state === "none") return { playing: false };
  if (np.state === "unsupported") return { playing: true, supported: false, type: np.type };
  return { playing: true, supported: true, type: "track", ...np.track };
}

// --- OAuth flow -----------------------------------------------------------

/** Creates+stores a CSRF state and returns the Spotify consent URL. */
export function beginConnect(userId: number): string {
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, userId);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID!,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    show_dialog: "true",
  });
  return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

/** True if `state` was issued for this user (does not consume it). */
export function isValidAuthState(state: string, userId: number): boolean {
  return pendingStates.get(state) === userId;
}

export function clearAuthState(state: string): void {
  pendingStates.delete(state);
}

/** Exchanges an authorization code for tokens and upserts the Connection. */
export async function exchangeCodeAndStore(userId: number, code: string): Promise<void> {
  const tokenRes = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    console.error("[spotify] token exchange failed:", tokenRes.status, detail);
    throw new Error("token_exchange_failed");
  }
  const data = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  const accessToken = encryptSecret(data.access_token);
  const refreshToken = encryptSecret(data.refresh_token);
  await prisma.connection.upsert({
    where: { userId_provider: { userId, provider: PROVIDER } },
    create: { userId, provider: PROVIDER, accessToken, refreshToken, expiresAt, scopes: data.scope ?? "" },
    update: { accessToken, refreshToken, expiresAt, scopes: data.scope ?? "" },
  });
}

// --- Profile + debug ------------------------------------------------------

/** Raw Spotify /me passthrough. Returns the status so the route can mirror it. */
export async function getProfile(
  userId: number,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const token = await getValidAccessToken(userId);
  const res = await fetch(`${SPOTIFY_API_BASE}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { ok: res.ok, status: res.status, data: res.ok ? await res.json() : null };
}

async function rawSpotifyGet(token: string, path: string) {
  const r = await fetch(`${SPOTIFY_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await r.text();
  let body: unknown = text || null;
  try {
    if (text) body = JSON.parse(text);
  } catch {
    /* leave as raw text */
  }
  return { status: r.status, statusText: r.statusText, contentType: r.headers.get("content-type"), body };
}

export async function getDebugInfo(userId: number) {
  const conn = await getConnection(userId);
  const token = await getValidAccessToken(userId);
  const [currentlyPlaying, player] = await Promise.all([
    rawSpotifyGet(token, "/me/player/currently-playing"),
    rawSpotifyGet(token, "/me/player"),
  ]);
  return {
    connected: true,
    requestedScopes: SCOPES,
    grantedScopes: conn?.scopes ?? null,
    currentlyPlaying,
    player,
  };
}
