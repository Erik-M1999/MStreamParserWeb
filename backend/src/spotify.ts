import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Spotify OAuth (Authorization Code flow).
//
// The client secret stays on this backend and is never sent to the browser.
// Tokens are kept IN MEMORY for now (single dev user, lost on restart) — this
// will be replaced by per-user DB storage (Session 04) + sessions (Session 05).
// ---------------------------------------------------------------------------

const router = Router();

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

// Read once at module load. Values come from backend/.env (see .env.example).
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI ??
  "http://127.0.0.1:3000/api/auth/spotify/callback";
const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN ?? "http://127.0.0.1:5173";

// Scopes: profile basics + reading the currently playing track (for IMD).
const SCOPES = "user-read-private user-read-email user-read-currently-playing";

interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  /** epoch ms when the access token expires */
  expires_at: number;
}

let tokens: SpotifyTokens | null = null;
// CSRF guard: the random "state" we sent to Spotify, expected back on callback.
let pendingState: string | null = null;
// The scopes Spotify actually granted (echoed back in the token response).
let grantedScopes: string | null = null;

/** Used by /api/connections to report whether Spotify is connected. */
export function isSpotifyConnected(): boolean {
  return tokens !== null;
}

function isConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export interface CurrentTrack {
  artist: string;
  title: string;
  album: string;
  coverUrl: string | null;
}

// Shape of the bits of Spotify's currently-playing response we use.
interface CurrentlyPlayingResponse {
  // "track" | "episode" | "ad" | "unknown"
  currently_playing_type?: string;
  item: {
    name: string;
    // artists/album are absent for episodes (podcasts).
    artists?: { name: string }[];
    album?: { name: string; images: { url: string }[] };
  } | null;
}

export type NowPlayingResult =
  | { state: "none" }
  | { state: "unsupported"; type: string }
  | { state: "track"; track: CurrentTrack };

async function refreshAccessToken(): Promise<void> {
  if (!tokens) throw new Error("not_connected");
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });
  if (!res.ok) throw new Error("refresh_failed");
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  tokens = {
    access_token: data.access_token,
    // Spotify may omit a new refresh token; keep the existing one if so.
    refresh_token: data.refresh_token ?? tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

/** Returns a usable access token, refreshing it if it's about to expire. */
export async function getValidAccessToken(): Promise<string> {
  if (!tokens) throw new Error("not_connected");
  if (Date.now() >= tokens.expires_at - 60_000) {
    await refreshAccessToken();
  }
  return tokens!.access_token;
}

/**
 * What's playing right now: nothing, an unsupported type (podcast episode/ad),
 * or a track with the fields we need.
 */
export async function getNowPlaying(): Promise<NowPlayingResult> {
  const token = await getValidAccessToken();
  const res = await fetch(`${SPOTIFY_API_BASE}/me/player/currently-playing`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204) return { state: "none" }; // nothing playing
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[spotify] currently-playing ${res.status}:`, detail);
    throw new Error(`spotify_${res.status}`);
  }

  const data = (await res.json()) as CurrentlyPlayingResponse;
  if (!data.item) return { state: "none" };

  // Only songs are supported — episodes (podcasts), ads, etc. are not.
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

// Step 1: send the user to Spotify's login/consent screen.
router.get("/auth/spotify/login", (_req: Request, res: Response) => {
  if (!isConfigured()) {
    res
      .status(500)
      .json({ error: "Spotify is not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in backend/.env." });
    return;
  }

  pendingState = crypto.randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID!,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state: pendingState,
    // Force the consent screen. Without this, an already-authorized user is
    // silently redirected and newly-added scopes are NOT granted.
    show_dialog: "true",
  });

  res.redirect(`${SPOTIFY_AUTH_URL}?${params.toString()}`);
});

// Step 2: Spotify redirects back here with ?code & ?state. We exchange the
// code for tokens, then bounce the user back to the frontend.
router.get("/auth/spotify/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    res.redirect(`${FRONTEND_ORIGIN}/?spotify=denied`);
    return;
  }
  if (typeof state !== "string" || state !== pendingState) {
    res.status(400).json({ error: "Invalid state parameter (possible CSRF)." });
    return;
  }
  if (typeof code !== "string") {
    res.status(400).json({ error: "Missing authorization code." });
    return;
  }
  pendingState = null;

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    });

    const tokenRes = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      },
      body,
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

    tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };
    grantedScopes = data.scope ?? null;
    console.log("[spotify] connected. granted scopes:", grantedScopes);

    res.redirect(`${FRONTEND_ORIGIN}/?spotify=connected`);
  } catch (err) {
    console.error("[spotify] callback error:", err);
    res.redirect(`${FRONTEND_ORIGIN}/?spotify=error`);
  }
});

// Step 3: the test fetch — call Spotify's /me with our access token and
// return the raw JSON profile.
router.get("/spotify/me", async (_req: Request, res: Response) => {
  if (!tokens) {
    res.status(401).json({ error: "Not connected to Spotify." });
    return;
  }

  try {
    const meRes = await fetch(`${SPOTIFY_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!meRes.ok) {
      const detail = await meRes.text();
      res
        .status(meRes.status)
        .json({ error: "Spotify API request failed.", detail });
      return;
    }

    const profile = await meRes.json();
    res.json(profile);
  } catch (err) {
    console.error("[spotify] /me error:", err);
    res.status(500).json({ error: "Failed to reach Spotify API." });
  }
});

// What's playing right now (used by the Immersive Display tool & UI).
router.get("/spotify/now-playing", async (_req: Request, res: Response) => {
  try {
    const np = await getNowPlaying();
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
    if (err instanceof Error && err.message === "not_connected") {
      res.status(401).json({ error: "Not connected to Spotify." });
      return;
    }
    console.error("[spotify] now-playing error:", err);
    res.status(502).json({ error: "Failed to reach Spotify." });
  }
});

// Debug helper: do a raw GET against Spotify and return status + parsed body.
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
  return {
    status: r.status,
    statusText: r.statusText,
    contentType: r.headers.get("content-type"),
    body,
  };
}

// Debug window: open http://127.0.0.1:3000/api/spotify/debug in the browser to
// see what Spotify actually returns (granted scopes, currently-playing, device).
router.get("/spotify/debug", async (_req: Request, res: Response) => {
  // Development-only: never expose raw Spotify data on a production server.
  if (process.env.NODE_ENV === "production") {
    res.sendStatus(404);
    return;
  }
  try {
    const token = await getValidAccessToken();
    const [currentlyPlaying, player] = await Promise.all([
      rawSpotifyGet(token, "/me/player/currently-playing"),
      rawSpotifyGet(token, "/me/player"),
    ]);
    res.json({
      connected: true,
      requestedScopes: SCOPES,
      grantedScopes,
      currentlyPlaying,
      player,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "not_connected") {
      res.status(401).json({ error: "Not connected to Spotify." });
      return;
    }
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
