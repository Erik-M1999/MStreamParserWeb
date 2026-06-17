import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Template library (read-only demo set for now).
//
// Serves the SVGs in backend/sample-templates as a virtual "_debug" folder,
// available to everyone. Once users + a database exist, real per-user
// templates/folders join this; the _debug set is removed for production.
// ---------------------------------------------------------------------------

const router = Router();
const TEMPLATES_DIR = path.join(__dirname, "..", "sample-templates");
const DEBUG_FOLDER = "_debug";

type Mode = "current-song" | "playlist" | "queue";

/** Which IMD mode(s) a template is eligible for (derived from its name). */
function modesForName(name: string): Mode[] {
  const n = name.toLowerCase();
  if (n.includes("currentsong") || n.includes("current_song")) return ["current-song"];
  if (n.includes("playlist")) return ["playlist"];
  if (n.includes("queue")) return ["queue"];
  return [];
}

function listSvgFiles(): string[] {
  try {
    return fs
      .readdirSync(TEMPLATES_DIR)
      .filter((f) => f.toLowerCase().endsWith(".svg"));
  } catch {
    return [];
  }
}

router.get("/templates", (_req: Request, res: Response) => {
  const items = listSvgFiles().map((file) => ({
    id: file,
    name: file.replace(/\.svg$/i, ""),
    folder: DEBUG_FOLDER,
    modes: modesForName(file),
    readOnly: true,
  }));
  res.json(items);
});

router.get("/templates/:id", (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  // Guard against path traversal: only bare filenames from the known list.
  if (id.includes("/") || id.includes("\\") || id.includes("..")) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  if (!listSvgFiles().includes(id)) {
    res.status(404).json({ error: "Template not found." });
    return;
  }
  const content = fs.readFileSync(path.join(TEMPLATES_DIR, id), "utf8");
  res.type("image/svg+xml").send(content);
});

export default router;
