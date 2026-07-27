import { Router, type Request, type Response } from "express";
import { authenticate, type AuthedRequest } from "../../middleware/authenticate.js";
import * as spotify from "./spotify.service.js";

// Spotify routes (thin). HTTP concerns only: OAuth redirects, SSE streaming,
// status mapping. All logic lives in spotify.service.ts.

const router = Router();
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://127.0.0.1:5173";

const userIdOf = (req: Request) => (req as AuthedRequest).user!.userId;

/** Maps Spotify service errors to HTTP responses. */
function handleSpotifyError(err: unknown, res: Response) {
  if (err instanceof Error && err.message === "not_connected") {
    res.status(409).json({ error: "Connect your Spotify account first." });
    return;
  }
  console.error("[spotify] error:", err);
  res.status(502).json({ error: "Failed to reach Spotify." });
}

// Step 1: send the user to Spotify's consent screen (must be logged in).
router.get("/auth/spotify/login", authenticate, (req: Request, res: Response) => {
  if (!spotify.isConfigured()) {
    res.status(500).json({
      error: "Spotify is not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in backend/.env.",
    });
    return;
  }
  res.redirect(spotify.beginConnect(userIdOf(req)));
});

// Step 2: Spotify redirects back (the auth cookie rides along on this nav).
router.get("/auth/spotify/callback", authenticate, async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  const { code, state, error } = req.query;

  if (error) {
    res.redirect(`${FRONTEND_ORIGIN}/?spotify=denied`);
    return;
  }
  if (typeof state !== "string" || !spotify.isValidAuthState(state, userId)) {
    res.status(400).json({ error: "Invalid state parameter (possible CSRF)." });
    return;
  }
  if (typeof code !== "string") {
    res.status(400).json({ error: "Missing authorization code." });
    return;
  }
  spotify.clearAuthState(state);

  try {
    await spotify.exchangeCodeAndStore(userId, code);
    res.redirect(`${FRONTEND_ORIGIN}/?spotify=connected`);
  } catch (err) {
    console.error("[spotify] callback error:", err);
    res.redirect(`${FRONTEND_ORIGIN}/?spotify=error`);
  }
});

router.post("/spotify/disconnect", authenticate, async (req: Request, res: Response) => {
  try {
    await spotify.disconnect(userIdOf(req));
    res.sendStatus(204);
  } catch (err) {
    handleSpotifyError(err, res);
  }
});

router.get("/spotify/me", authenticate, async (req: Request, res: Response) => {
  try {
    const { ok, status, data } = await spotify.getProfile(userIdOf(req));
    if (!ok) {
      res.status(status).json({ error: "Spotify API request failed." });
      return;
    }
    res.json(data);
  } catch (err) {
    handleSpotifyError(err, res);
  }
});

// Playlist Extractor: list the user's playlists, and export one to ordered tracks.
router.get("/spotify/playlists", authenticate, async (req: Request, res: Response) => {
  try {
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 50);
    res.json(await spotify.listMyPlaylistsPage(userIdOf(req), offset, limit));
  } catch (err) {
    handleSpotifyError(err, res);
  }
});

router.get("/spotify/playlists/:id", authenticate, async (req: Request, res: Response) => {
  try {
    res.json(await spotify.getPlaylistExport(userIdOf(req), String(req.params.id)));
  } catch (err) {
    if (err instanceof Error && err.message === "playlist_not_found") {
      res.status(404).json({ error: "Playlist not found or not accessible." });
      return;
    }
    handleSpotifyError(err, res);
  }
});

router.get("/spotify/now-playing", authenticate, async (req: Request, res: Response) => {
  try {
    res.json(spotify.toNowPlayingPayload(await spotify.getNowPlaying(userIdOf(req))));
  } catch (err) {
    handleSpotifyError(err, res);
  }
});

// Live now-playing via Server-Sent Events. The server polls per connected client
// and emits an event only when the track changes; EventSource auto-reconnects on
// drop. One-way (server -> client); see the README's SSE vs WebSockets note.
router.get("/spotify/now-playing/stream", authenticate, (req: Request, res: Response) => {
  const userId = userIdOf(req);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // don't let a proxy buffer the stream
  res.flushHeaders();

  let closed = false;
  let lastPayload = ""; // only push when the serialized payload changes

  async function tick() {
    if (closed) return;
    try {
      const payload = JSON.stringify(
        spotify.toNowPlayingPayload(await spotify.getNowPlaying(userId)),
      );
      if (payload !== lastPayload) {
        lastPayload = payload;
        res.write(`data: ${payload}\n\n`);
      }
    } catch {
      // Transient Spotify/refresh error — skip this tick and try again later.
    }
  }

  void tick(); // push the current state immediately
  const poll = setInterval(() => void tick(), 6000);
  const heartbeat = setInterval(() => {
    if (!closed) res.write(": ping\n\n"); // comment line keeps the connection warm
  }, 25000);

  req.on("close", () => {
    closed = true;
    clearInterval(poll);
    clearInterval(heartbeat);
    res.end();
  });
});

router.get("/spotify/debug", authenticate, async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    res.sendStatus(404);
    return;
  }
  try {
    res.json(await spotify.getDebugInfo(userIdOf(req)));
  } catch (err) {
    handleSpotifyError(err, res);
  }
});

export default router;
