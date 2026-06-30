import { Router, type Request, type Response } from "express";
import {
  getNowPlaying,
  getQueue,
  getPlaylists,
  getValidAccessToken,
} from "./spotify.js";
import { authenticate, type AuthedRequest } from "../middleware/authenticate.js";
import { fillTemplate, type TemplateFill } from "../svgTemplate.js";

// ---------------------------------------------------------------------------
// ImmersiveMusicDisplay — render endpoint.
// Takes an uploaded SVG template + a mode, fills it with the relevant Spotify
// data, and returns the filled SVG. Modes: current-song, queue, playlist.
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

interface ConflictError {
  status: 409;
  message: string;
}

/** Builds the slot fill for a mode. Throws a ConflictError when there's no
 *  suitable Spotify data (e.g. nothing playing). */
async function buildFill(
  mode: string,
  userId: number,
): Promise<{
  text: Record<string, string>;
  imageUrls: Record<string, string | null>;
}> {
  const text: Record<string, string> = {};
  const imageUrls: Record<string, string | null> = {};

  if (mode === "current-song") {
    const np = await getNowPlaying(userId);
    if (np.state === "none") {
      throw {
        status: 409,
        message: "Nothing is playing on Spotify right now. Start playback and try again.",
      } as ConflictError;
    }
    if (np.state === "unsupported") {
      const label =
        np.type === "episode" ? "a podcast episode" : np.type === "ad" ? "an ad" : `a ${np.type}`;
      throw {
        status: 409,
        message: `Spotify is playing ${label}. Only songs are supported — play a track and try again.`,
      } as ConflictError;
    }
    text.artist = np.track.artist;
    text.title = np.track.title;
    imageUrls.cover = np.track.coverUrl;
  } else if (mode === "queue") {
    const q = await getQueue(userId);
    if (!q.current) {
      throw {
        status: 409,
        message: "Nothing is playing on Spotify right now. Start playback and try again.",
      } as ConflictError;
    }
    const list = [q.current, ...q.queue];
    for (let i = 0; i < 6 && i < list.length; i++) {
      const e = list[i];
      const suffix = i === 0 ? "current" : `${i + 1}`; // current, 2..6
      text[i === 0 ? "current_title" : `title${suffix}`] = e.title;
      text[i === 0 ? "current_artist" : `artist${suffix}`] = e.artist;
      imageUrls[i === 0 ? "current_cover" : `cover${suffix}`] = e.coverUrl;
    }
  } else if (mode === "playlist") {
    const pls = await getPlaylists(userId, 5);
    if (pls.length === 0) {
      throw { status: 409, message: "No playlists found on your account." } as ConflictError;
    }
    for (let i = 0; i < 5 && i < pls.length; i++) {
      const p = pls[i];
      const n = i + 2; // 2..6
      text[`title${n}`] = p.title;
      text[`artist${n}`] = p.creator;
      imageUrls[`cover${n}`] = p.coverUrl;
    }
  } else {
    throw { status: 409, message: `Unknown mode "${mode}".` } as ConflictError;
  }

  return { text, imageUrls };
}

function isConflict(e: unknown): e is ConflictError {
  return typeof e === "object" && e !== null && (e as ConflictError).status === 409;
}

router.post("/immersive/render", authenticate, async (req: Request, res: Response) => {
  const userId = (req as AuthedRequest).user!.userId;
  const template = typeof req.body === "string" ? req.body : "";
  if (!template.trim()) {
    res.status(400).json({ error: "No SVG template was provided." });
    return;
  }

  const mode =
    typeof req.query.mode === "string" ? req.query.mode : "current-song";

  // Must have a Spotify connection.
  try {
    await getValidAccessToken(userId);
  } catch {
    res.status(409).json({ error: "Connect your Spotify account first." });
    return;
  }

  // Gather the mode's data from Spotify.
  let text: Record<string, string>;
  let imageUrls: Record<string, string | null>;
  try {
    ({ text, imageUrls } = await buildFill(mode, userId));
  } catch (err) {
    if (isConflict(err)) {
      res.status(409).json({ error: err.message });
      return;
    }
    console.error("[immersive] spotify error:", err);
    res.status(502).json({ error: "Failed to reach Spotify." });
    return;
  }

  // Inline every cover as a data URI (in parallel).
  const images: Record<string, string | null> = {};
  await Promise.all(
    Object.entries(imageUrls).map(async ([slot, url]) => {
      images[slot] = url ? await fetchCoverDataUri(url) : null;
    }),
  );

  // Fill the template. A bad/unsupported template yields a clear 400.
  try {
    const fill: TemplateFill = { text, images };
    res.type("image/svg+xml").send(fillTemplate(template, fill));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not process the SVG template.";
    console.error("[immersive] fill error:", message);
    res.status(400).json({ error: message });
  }
});

export default router;
