import express, { type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import spotifyRouter from "./modules/spotify/spotify.routes.js";
import { isSpotifyConnected } from "./modules/spotify/spotify.service.js";
import lastfmRouter from "./modules/lastfm/lastfm.routes.js";
import { isLastfmConnected } from "./modules/lastfm/lastfm.service.js";
import immersiveRouter from "./modules/rendering/rendering.routes.js";
import authRouter from "./modules/auth/auth.routes.js";
import { optionalUser } from "./middleware/authenticate.js";
import libraryRouter from "./modules/library/library.routes.js";
import apiKeysRouter from "./modules/apikeys/apikeys.routes.js";
import externalRouter from "./modules/external/external.routes.js";

// ---------------------------------------------------------------------------
// MStreamParserWeb — Express backend (port 3000)
//
// For now this is a tiny, read-only API that serves placeholder dashboard data.
// No database, no auth, no external API calls yet — we add those in later steps.
// The Next.js home page (a Server Component) fetches these endpoints at load.
// ---------------------------------------------------------------------------

// --- Fail-fast configuration check -----------------------------------------
// Both of these are load-bearing for security, and both degrade *quietly* when
// missing: without JWT_SECRET every authenticated route just 401s, and without
// TOKEN_ENC_KEY the Spotify token encryption throws on first use — deep inside
// a request, long after a deploy looked successful. Refuse to boot instead.
const REQUIRED_ENV = ["JWT_SECRET", "TOKEN_ENC_KEY"] as const;
const missing = REQUIRED_ENV.filter((k) => !(process.env[k] ?? "").trim());
if (missing.length > 0) {
  console.error(
    `[backend] FATAL: missing required environment variable(s): ${missing.join(", ")}.\n` +
      `          Set them in backend/.env (local) or the konsoleH Node.js env (prod).\n` +
      `          See backend/.env.example.`,
  );
  process.exit(1);
}

const app = express();

// In production the app runs behind Hetzner's Apache reverse proxy, which
// terminates HTTPS. `trust proxy` lets Express see the real protocol/client IP
// (so secure cookies and req.ip work correctly).
app.set("trust proxy", 1);

// --- Global security headers -----------------------------------------------
// Set by hand rather than pulling in helmet: it is four headers, and we already
// keep the dependency list deliberately small. Note there is no global CSP —
// SVG responses set their own strict one (shared/svgResponse.ts), and a blanket
// policy would break the Next.js static export we serve further down.
app.use((req: Request, res: Response, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff"); // no MIME sniffing
  res.setHeader("X-Frame-Options", "DENY"); // no framing => no clickjacking
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // HSTS only where the connection is actually HTTPS — sending it over plain
  // http on a real domain would pin browsers to a scheme we can't serve.
  if (req.secure) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
});

// The hosting platform assigns the port via PORT; fall back to 3000 locally.
const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://127.0.0.1:5173";

// Allow our frontend's browser-side calls (e.g. the SVG Texture Labs tool).
// Both loopback spellings are allowed because the Next dev server answers on
// localhost AND 127.0.0.1, and the browser treats them as different origins.
const ALLOWED_ORIGINS = new Set([
  FRONTEND_ORIGIN,
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

// Minimal CORS. No credentials yet — the Spotify token lives on the backend.
app.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    // Allow the HttpOnly auth cookie on cross-origin (port-differing) calls.
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Parse uploaded SVG templates (and plain text) as a raw string body.
app.use(express.text({ type: ["image/svg+xml", "text/plain"], limit: "2mb" }));
// Parse JSON bodies (auth routes). Different content-type from the text parser.
app.use(express.json());

// --- Data shapes -----------------------------------------------------------

type ToolStatus = "available" | "coming-soon";

interface Tool {
  id: string;
  name: string;
  description: string;
  status: ToolStatus;
}

interface ApiConnection {
  id: string;
  name: string;
  /** Whether this API is connected in the current session. */
  connected: boolean;
}

// --- Placeholder data (hard-coded until we wire up real sources) -----------

const tools: Tool[] = [
  {
    id: "playlist-parser",
    name: "Playlist Extractor",
    description: "Convert a Spotify playlist into a plain .txt track list.",
    status: "available",
  },
  {
    id: "immersive-display",
    name: "SVG Texture Labs",
    description: "Fill an SVG template with the song you're currently playing.",
    status: "available",
  },
];


// --- Routes ----------------------------------------------------------------

// Simple health check, handy for confirming the server is up.
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// The available tools shown on the dashboard.
app.get("/api/tools", (_req: Request, res: Response) => {
  res.json(tools);
});

// The available APIs and whether they're connected — per logged-in user.
app.get("/api/connections", async (req: Request, res: Response) => {
  const user = optionalUser(req);
  const [spotify, lastfm] = user
    ? await Promise.all([
        isSpotifyConnected(user.userId),
        isLastfmConnected(user.userId),
      ])
    : [false, false];
  res.json([
    { id: "spotify", name: "Spotify", connected: spotify },
    { id: "lastfm", name: "Last.fm", connected: lastfm },
  ]);
});

// Spotify OAuth + test-fetch routes (mounted under /api).
app.use("/api", spotifyRouter);

// Last.fm connect + now-playing routes (mounted under /api).
app.use("/api", lastfmRouter);

// ImmersiveMusicDisplay render route (mounted under /api).
app.use("/api", immersiveRouter);

// Auth routes (register / login / logout / me) under /api.
app.use("/api", authRouter);

// Library context: demo templates (public) + per-user templates/folders (auth).
app.use("/api", libraryRouter);

// API keys management (cookie auth) + the external API for tools (/api/v1, key auth).
app.use("/api", apiKeysRouter);
app.use("/api", externalRouter);

// Unknown /api/* paths get a clean JSON 404 — so they never fall through to the
// SPA fallback below and get answered with index.html (HTML for an API call).
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// --- Static frontend + SPA fallback (production single-app deploy) ----------
// In the deployed build the Next.js static export is copied into backend/public
// and Express serves it on the same origin as the API. Locally this folder does
// not exist (Next runs its own dev server on :5173), so we mount it only when
// present — keeping dev untouched.
const PUBLIC_DIR = path.join(__dirname, "..", "public");
if (fs.existsSync(path.join(PUBLIC_DIR, "index.html"))) {
  // 1) Real files only: hashed _next assets, RSC .txt payloads, images, etc.
  //    index:false + redirect:false so route directories (e.g. login/, which
  //    holds Next's client-nav payloads) don't shadow the <route>.html files.
  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      redirect: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}_next${path.sep}`)) {
          // Content-hashed assets never change -> cache hard.
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );

  // 2) Page routes: the export writes one prerendered file per page, so map the
  //    clean URL to it (/login -> login.html, / -> index.html). Unknown paths
  //    get Next's 404 page. index.html/*.html are always sent no-cache.
  app.use((req: Request, res: Response) => {
    const rel = req.path === "/" ? "index" : req.path.replace(/^\/+/, "");
    const htmlFile = path.join(PUBLIC_DIR, `${rel}.html`);
    res.setHeader("Cache-Control", "no-cache");
    // Containment guard against path traversal (never serve outside PUBLIC_DIR).
    if (htmlFile.startsWith(PUBLIC_DIR + path.sep) && fs.existsSync(htmlFile)) {
      res.sendFile(htmlFile);
    } else {
      res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"));
    }
  });
}

app.listen(PORT, () => {
  console.log(`[backend] listening on http://127.0.0.1:${PORT}`);
});
