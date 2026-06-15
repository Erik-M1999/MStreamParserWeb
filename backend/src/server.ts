import express, { type Request, type Response } from "express";

// ---------------------------------------------------------------------------
// MStreamParserWeb — Express backend (port 3000)
//
// For now this is a tiny, read-only API that serves placeholder dashboard data.
// No database, no auth, no external API calls yet — we add those in later steps.
// The Next.js home page (a Server Component) fetches these endpoints at load.
// ---------------------------------------------------------------------------

const app = express();
const PORT = 3000;

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
    name: "Playlist Parser",
    description: "Convert playlists into plain .txt or .csv files.",
    status: "coming-soon",
  },
  {
    id: "immersive-display",
    name: "Immersive Music Display",
    description: "Visualize what you are listening to in real time.",
    status: "coming-soon",
  },
];

const connections: ApiConnection[] = [
  { id: "spotify", name: "Spotify", connected: false },
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

// The available APIs and whether they are connected this session.
app.get("/api/connections", (_req: Request, res: Response) => {
  res.json(connections);
});

app.listen(PORT, () => {
  console.log(`[backend] listening on http://127.0.0.1:${PORT}`);
});
