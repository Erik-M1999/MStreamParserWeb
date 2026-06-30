import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { prisma } from "../db.js";
import { encryptSecret, decryptSecret } from "../crypto.js";
import { authenticate, type AuthedRequest } from "../middleware/authenticate.js";

// ---------------------------------------------------------------------------
// Spotify OAuth (Authorization Code flow), scoped PER USER.
//
// Every route requires a logged-in account. Tokens are stored in the DB as a
// Connection row keyed by userId, so one user can never see another's Spotify
// data. The client secret stays on the backend.
// ---------------------------------------------------------------------------

const router = Router();
const PROVIDER = "spotify";

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI ??
  "http://127.0.0.1:3000/api/auth/spotify/callback";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://127.0.0.1:5173";

const SCOPES =
  "user-read-private user-read-email user-read-currently-playing user-read-playback-state playlist-read-private";

// Pending OAuth states: state -> userId (CSRF guard + per-user binding).
const pendingStates = new Map<string, number>();

function userIdOf(req: Request): number {
  return (req as AuthedRequest).user!.userId;
}
function isConfigured(): boolean {
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

// Step 1: send the user to Spotify's consent screen (must be logged in).
router.get("/auth/spotify/login", authenticate, (req: Request, res: Response) => {
  if (!isConfigured()) {
    res.status(500).json({
      error: "Spotify is not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in backend/.env.",
    });
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, userIdOf(req));

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID!,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    show_dialog: "true",
  });
  res.redirect(`${SPOTIFY_AUTH_URL}?${params.toString()}`);
});

// Step 2: Spotify redirects back (the auth cookie rides along on this nav).
router.get("/auth/spotify/callback", authenticate, async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  const { code, state, error } = req.query;

  if (error) {
    res.redirect(`${FRONTEND_ORIGIN}/?spotify=denied`);
    return;
  }
  if (typeof state !== "string" || pendingStates.get(state) !== userId) {
    res.status(400).json({ error: "Invalid state parameter (possible CSRF)." });
    return;
  }
  if (typeof code !== "string") {
    res.status(400).json({ error: "Missing authorization code." });
    return;
  }
  pendingStates.delete(state);

  try {
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
      res.redirect(`${FRONTEND_ORIGIN}/?spotify=error`);
      return;
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
      create: {
        userId,
        provider: PROVIDER,
        accessToken,
        refreshToken,
        expiresAt,
        scopes: data.scope ?? "",
      },
      update: {
        accessToken,
        refreshToken,
        expiresAt,
        scopes: data.scope ?? "",
      },
    });
    res.redirect(`${FRONTEND_ORIGIN}/?spotify=connected`);
  } catch (err) {
    console.error("[spotify] callback error:", err);
    res.redirect(`${FRONTEND_ORIGIN}/?spotify=error`);
  }
});

/** Maps Spotify helper errors to HTTP responses. */
function handleSpotifyError(err: unknown, res: Response) {
  if (err instanceof Error && err.message === "not_connected") {
    res.status(409).json({ error: "Connect your Spotify account first." });
    return;
  }
  console.error("[spotify] error:", err);
  res.status(502).json({ error: "Failed to reach Spotify." });
}

router.get("/spotify/me", authenticate, async (req: Request, res: Response) => {
  try {
    const token = await getValidAccessToken(userIdOf(req));
    const meRes = await fetch(`${SPOTIFY_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) {
      res.status(meRes.status).json({ error: "Spotify API request failed." });
      return;
    }
    res.json(await meRes.json());
  } catch (err) {
    handleSpotifyError(err, res);
  }
});

router.get("/spotify/now-playing", authenticate, async (req: Request, res: Response) => {
  try {
    const np = await getNowPlaying(userIdOf(req));
    if (np.state === "none") {
      res.json({ playing: false });
      return;
    }
    if (np.state === "unsupported") {
      res.json({ playing: true, supported: false, type: np.type });
      return;
    }
    res.json({ playing: true, supported: true, type: "track", ...np.track });
  } catch (err) {
    handleSpotifyError(err, res);
  }
});

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

router.get("/spotify/debug", authenticate, async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    res.sendStatus(404);
    return;
  }
  try {
    const userId = userIdOf(req);
    const conn = await getConnection(userId);
    const token = await getValidAccessToken(userId);
    const [currentlyPlaying, player] = await Promise.all([
      rawSpotifyGet(token, "/me/player/currently-playing"),
      rawSpotifyGet(token, "/me/player"),
    ]);
    res.json({
      connected: true,
      requestedScopes: SCOPES,
      grantedScopes: conn?.scopes ?? null,
      currentlyPlaying,
      player,
    });
  } catch (err) {
    handleSpotifyError(err, res);
  }
});

export default router;
