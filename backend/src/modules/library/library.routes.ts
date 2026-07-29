import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { authenticate, type AuthedRequest } from "../../middleware/authenticate.js";
import { route } from "../../shared/route.js";
import { sendSvg } from "../../shared/svgResponse.js";
import * as library from "./library.service.js";

// ---------------------------------------------------------------------------
// Library context routes (one cohesive router):
//   - GET /sample-templates[/:id]  → public read-only demo set (Demo Templates)
//   - /templates  + /folders       → per-user CRUD (authenticated)
// All per-user logic lives in library.service.ts; handlers stay thin.
// ---------------------------------------------------------------------------

const router = Router();

const userIdOf = (req: Request) => (req as AuthedRequest).user!.userId;
const idParam = (req: Request) =>
  Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;

// --- Public demo templates (read-only, served from disk) -------------------
// dist/modules/library/library.routes.js -> ../../../sample-templates
const TEMPLATES_DIR = path.join(__dirname, "..", "..", "..", "sample-templates");
const DEMO_FOLDER = "Demo Templates";

type Mode = "current-song" | "playlist" | "queue";

function modesForName(name: string): Mode[] {
  // Normalize away spaces/underscores so "Current Song", "current_song" and
  // "CurrentSong" all match.
  const n = name.toLowerCase().replace(/[\s_]+/g, "");
  if (n.includes("currentsong")) return ["current-song"];
  if (n.includes("playlist")) return ["playlist"];
  if (n.includes("queue")) return ["queue"];
  return [];
}

function listSvgFiles(): string[] {
  try {
    return fs.readdirSync(TEMPLATES_DIR).filter((f) => f.toLowerCase().endsWith(".svg"));
  } catch {
    return [];
  }
}

router.get("/sample-templates", (_req: Request, res: Response) => {
  res.json(
    listSvgFiles().map((file) => ({
      id: file,
      name: file.replace(/\.svg$/i, ""),
      folder: DEMO_FOLDER,
      modes: modesForName(file),
      readOnly: true,
    })),
  );
});

router.get("/sample-templates/:id", (req: Request, res: Response) => {
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
  sendSvg(res, fs.readFileSync(path.join(TEMPLATES_DIR, id), "utf8"));
});

// --- Per-user templates (authenticated) ------------------------------------
router.get(
  "/templates",
  authenticate,
  route(async (req, res) => {
    const f = req.query.folderId;
    res.json(await library.listTemplates(userIdOf(req), typeof f === "string" ? f : undefined));
  }),
);

router.get(
  "/templates/:id",
  authenticate,
  route(async (req, res) => {
    res.json(await library.getTemplate(userIdOf(req), idParam(req)));
  }),
);

router.post(
  "/templates",
  authenticate,
  route(async (req, res) => {
    res.status(201).json(await library.createTemplate(userIdOf(req), body(req)));
  }),
);

router.put(
  "/templates/:id",
  authenticate,
  route(async (req, res) => {
    res.json(await library.updateTemplate(userIdOf(req), idParam(req), body(req)));
  }),
);

router.delete(
  "/templates/:id",
  authenticate,
  route(async (req, res) => {
    await library.deleteTemplate(userIdOf(req), idParam(req));
    res.status(204).end();
  }),
);

// --- Per-user folders (authenticated) --------------------------------------
router.get(
  "/folders",
  authenticate,
  route(async (req, res) => {
    res.json(await library.listFolders(userIdOf(req)));
  }),
);

router.get(
  "/folders/:id",
  authenticate,
  route(async (req, res) => {
    res.json(await library.getFolder(userIdOf(req), idParam(req)));
  }),
);

router.get(
  "/folders/:id/templates",
  authenticate,
  route(async (req, res) => {
    res.json(await library.listFolderTemplates(userIdOf(req), idParam(req)));
  }),
);

router.post(
  "/folders",
  authenticate,
  route(async (req, res) => {
    res.status(201).json(await library.createFolder(userIdOf(req), body(req)));
  }),
);

router.put(
  "/folders/:id",
  authenticate,
  route(async (req, res) => {
    res.json(await library.updateFolder(userIdOf(req), idParam(req), body(req)));
  }),
);

router.delete(
  "/folders/:id",
  authenticate,
  route(async (req, res) => {
    await library.deleteFolder(userIdOf(req), idParam(req));
    res.status(204).end();
  }),
);

export default router;
