import { Router, type Request, type Response } from "express";
import { authenticate, type AuthedRequest } from "../../middleware/authenticate.js";
import * as lastfm from "./lastfm.service.js";

// Last.fm routes (thin). Connect stores a verified username; the reads mirror
// the Spotify now-playing shape so the frontend can stay provider-blind.

const router = Router();
const userIdOf = (req: Request) => (req as AuthedRequest).user!.userId;

/** Maps Last.fm service errors to HTTP responses. */
function handleLastfmError(err: unknown, res: Response) {
  const msg = err instanceof Error ? err.message : "";
  switch (msg) {
    case "invalid_username":
      res.status(400).json({ error: "Enter a valid Last.fm username or profile link." });
      return;
    case "user_not_found":
      res.status(404).json({ error: "No Last.fm user with that name." });
      return;
    case "not_connected":
      res.status(409).json({ error: "Connect your Last.fm account first." });
      return;
    case "not_configured":
      res.status(500).json({
        error: "Last.fm is not configured. Set LASTFM_API_KEY in backend/.env.",
      });
      return;
    default:
      console.error("[lastfm] error:", err);
      res.status(502).json({ error: "Failed to reach Last.fm." });
  }
}

// Connect by username or profile link (validated against user.getInfo).
router.post("/lastfm/connect", authenticate, async (req: Request, res: Response) => {
  const input = (req.body?.username ?? req.body?.input ?? "") as string;
  if (typeof input !== "string" || !input.trim()) {
    res.status(400).json({ error: "Enter your Last.fm username or profile link." });
    return;
  }
  try {
    const username = await lastfm.verifyAndConnect(userIdOf(req), input);
    res.json({ username });
  } catch (err) {
    handleLastfmError(err, res);
  }
});

router.post("/lastfm/disconnect", authenticate, async (req: Request, res: Response) => {
  try {
    await lastfm.disconnect(userIdOf(req));
    res.sendStatus(204);
  } catch (err) {
    handleLastfmError(err, res);
  }
});

router.get("/lastfm/me", authenticate, async (req: Request, res: Response) => {
  try {
    res.json(await lastfm.getProfile(userIdOf(req)));
  } catch (err) {
    handleLastfmError(err, res);
  }
});

router.get("/lastfm/now-playing", authenticate, async (req: Request, res: Response) => {
  try {
    res.json(lastfm.toNowPlayingPayload(await lastfm.getNowPlaying(userIdOf(req))));
  } catch (err) {
    handleLastfmError(err, res);
  }
});

// Live now-playing via SSE (mirrors the Spotify stream). Polls Last.fm on a
// gentler interval since its rate limits are informal ("don't call several/sec").
router.get("/lastfm/now-playing/stream", authenticate, (req: Request, res: Response) => {
  const userId = userIdOf(req);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;
  let lastPayload = "";

  async function tick() {
    if (closed) return;
    try {
      const payload = JSON.stringify(
        lastfm.toNowPlayingPayload(await lastfm.getNowPlaying(userId)),
      );
      if (payload !== lastPayload) {
        lastPayload = payload;
        res.write(`data: ${payload}\n\n`);
      }
    } catch {
      // Transient Last.fm error — skip this tick and try again later.
    }
  }

  void tick();
  const poll = setInterval(() => void tick(), 12000);
  const heartbeat = setInterval(() => {
    if (!closed) res.write(": ping\n\n");
  }, 25000);

  req.on("close", () => {
    closed = true;
    clearInterval(poll);
    clearInterval(heartbeat);
    res.end();
  });
});

export default router;
