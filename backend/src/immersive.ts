import { Router, type Request, type Response } from "express";
import {
  getCurrentTrack,
  getValidAccessToken,
  type CurrentTrack,
} from "./spotify.js";
import { fillCurrentSongTemplate } from "./svgTemplate.js";

// ---------------------------------------------------------------------------
// ImmersiveMusicDisplay — render endpoint.
// Takes an uploaded SVG template, fills it with the currently playing track,
// and returns the filled SVG. "current song" mode only, for now.
// ---------------------------------------------------------------------------

const router = Router();

/** Fetch the cover image and inline it as a data URI (portable, self-contained). */
async function fetchCoverDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const bytes = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

router.post("/immersive/render", async (req: Request, res: Response) => {
  const template = typeof req.body === "string" ? req.body : "";
  if (!template.trim()) {
    res.status(400).json({ error: "No SVG template was provided." });
    return;
  }

  // Must be connected to Spotify.
  try {
    await getValidAccessToken();
  } catch {
    res.status(401).json({ error: "Not connected to Spotify." });
    return;
  }

  // Must be playing something.
  let track: CurrentTrack | null;
  try {
    track = await getCurrentTrack();
  } catch (err) {
    console.error("[immersive] current track error:", err);
    res.status(502).json({ error: "Failed to reach Spotify." });
    return;
  }
  if (!track) {
    res.status(409).json({
      error: "Nothing is playing on Spotify right now. Start playback and try again.",
    });
    return;
  }

  const coverDataUri = track.coverUrl
    ? await fetchCoverDataUri(track.coverUrl)
    : null;

  // Fill the template. A bad/unsupported template yields a clear 400.
  try {
    const filled = fillCurrentSongTemplate(template, {
      artist: track.artist,
      title: track.title,
      coverDataUri,
    });
    res.type("image/svg+xml").send(filled);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not process the SVG template.";
    console.error("[immersive] fill error:", message);
    res.status(400).json({ error: message });
  }
});

export default router;
