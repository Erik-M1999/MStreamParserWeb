import express, { type Request, type Response } from "express";
import spotifyRouter from "./modules/spotify/spotify.routes.js";
import { isSpotifyConnected } from "./modules/spotify/spotify.service.js";
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

const app = express();
const PORT = 3000;
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
    description: "Convert playlists into plain .txt or .csv files.",
    status: "coming-soon",
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
  const connected = user ? await isSpotifyConnected(user.userId) : false;
  res.json([{ id: "spotify", name: "Spotify", connected }]);
});

// Spotify OAuth + test-fetch routes (mounted under /api).
app.use("/api", spotifyRouter);

// ImmersiveMusicDisplay render route (mounted under /api).
app.use("/api", immersiveRouter);

// Auth routes (register / login / logout / me) under /api.
app.use("/api", authRouter);

// Library context: demo templates (public) + per-user templates/folders (auth).
app.use("/api", libraryRouter);

// API keys management (cookie auth) + the external API for tools (/api/v1, key auth).
app.use("/api", apiKeysRouter);
app.use("/api", externalRouter);

app.listen(PORT, () => {
  console.log(`[backend] listening on http://127.0.0.1:${PORT}`);
});
