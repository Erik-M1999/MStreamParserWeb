import { Resvg } from "@resvg/resvg-js";
import {
  getNowPlaying,
  getQueue,
  getPlaylists,
  getValidAccessToken,
  isReauthRequired,
} from "../spotify/spotify.service.js";
import { fillTemplate, type TemplateFill } from "../../svgTemplate.js";
import { HttpError } from "../../shared/errors.js";

/** Rasterizes a (filled) SVG to a PNG Buffer — the server-side replacement for
 *  the old Inkscape step. `longest` sets the output's LONGEST side in px,
 *  capped at the SVG's natural size (never upscales); omit/0 = natural size.
 *  Covers are inlined data URIs, so no network. */
export function svgToPng(svg: string, longest?: number): Buffer {
  const probe = new Resvg(svg);
  const natLongest = Math.max(probe.width, probe.height);
  const target =
    longest && longest > 0 ? Math.min(longest, natLongest) : natLongest;

  // At or above natural size → render as-is (the cap is the original size).
  if (target >= natLongest) return probe.render().asPng();

  const fitTo: { mode: "width"; value: number } | { mode: "height"; value: number } =
    probe.width >= probe.height
      ? { mode: "width", value: target }
      : { mode: "height", value: target };
  return new Resvg(svg, { fitTo }).render().asPng();
}

// ---------------------------------------------------------------------------
// Rendering context: fills an uploaded SVG template with the user's live Spotify
// data and returns the filled SVG. Stateless — owns no tables. This is the one
// context that calls another: it asks the Spotify service for normalized track
// data (never touching the Connection row / token directly).
//
// Public:   render
// Internal: buildFill, fetchCoverDataUri, ConflictError
// ---------------------------------------------------------------------------

// Cover URLs arrive inside Spotify/Last.fm API responses, so they are not
// user-typed — but they are still values from a third party that we hand
// straight to fetch(). Restricting them to the providers' image CDNs means a
// compromised or spoofed upstream response can't turn this into a probe of our
// own network (the response body is base64'd into the SVG we return, so an SSRF
// here would leak whatever it reached).
const ALLOWED_COVER_HOSTS = [
  ".scdn.co", // Spotify album/playlist art (i., mosaic., lineup-images., …)
  ".spotifycdn.com", // newer Spotify image CDN
  "lastfm.freetls.fastly.net", // Last.fm art
  ".last.fm",
];

function isAllowedCoverUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_COVER_HOSTS.some((h) =>
    h.startsWith(".") ? host.endsWith(h) : host === h,
  );
}

/** Fetch the cover image and inline it as a data URI (portable, self-contained). */
async function fetchCoverDataUri(url: string): Promise<string | null> {
  if (!isAllowedCoverUrl(url)) {
    // Not fatal: the template just renders without art. Logged so a genuinely
    // new provider CDN shows up here instead of silently losing every cover.
    console.warn("[rendering] refusing cover URL from unexpected host:", url);
    return null;
  }
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
function isConflict(e: unknown): e is ConflictError {
  return typeof e === "object" && e !== null && (e as ConflictError).status === 409;
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

/** Fills the template with the user's current Spotify data for the given mode.
 *  Throws HttpError: 400 (bad/empty template), 409 (not connected / nothing to
 *  render), 502 (Spotify unreachable). */
export async function render(userId: number, svg: string, mode: string): Promise<string> {
  if (!svg.trim()) throw new HttpError(400, "No SVG template was provided.");

  // Must have a Spotify connection. A grant that expired (Spotify's 6-month
  // refresh-token lifetime) gets its own message so the user knows to reconnect
  // rather than thinking they were never connected.
  try {
    await getValidAccessToken(userId);
  } catch (err) {
    if (isReauthRequired(err)) {
      throw new HttpError(
        409,
        "Your Spotify authorization has expired. Reconnect Spotify and try again.",
      );
    }
    throw new HttpError(409, "Connect your Spotify account first.");
  }

  // Gather the mode's data from Spotify.
  let text: Record<string, string>;
  let imageUrls: Record<string, string | null>;
  try {
    ({ text, imageUrls } = await buildFill(mode, userId));
  } catch (err) {
    if (isConflict(err)) throw new HttpError(409, err.message);
    console.error("[rendering] spotify error:", err);
    throw new HttpError(502, "Failed to reach Spotify.");
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
    return fillTemplate(svg, fill);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not process the SVG template.";
    console.error("[rendering] fill error:", message);
    throw new HttpError(400, message);
  }
}
