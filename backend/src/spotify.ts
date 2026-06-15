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

// Minimal scopes for our test fetch of the user's profile.
const SCOPES = "user-read-private user-read-email";

interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  /** epoch ms when the access token expires */
  expires_at: number;
}

let tokens: SpotifyTokens | null = null;
// CSRF guard: the random "state" we sent to Spotify, expected back on callback.
let pendingState: string | null = null;

/** Used by /api/connections to report whether Spotify is connected. */
export function isSpotifyConnected(): boolean {
  return tokens !== null;
}

function isConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
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
    };

    tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };

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

export default router;
