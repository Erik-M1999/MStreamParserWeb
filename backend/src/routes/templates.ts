import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { authenticate, type AuthedRequest } from "../middleware/authenticate.js";

// Per-user template CRUD. Every query is scoped to the authenticated user, so
// nobody can read or modify another user's templates.

const router = Router();
router.use(authenticate);

function userIdOf(req: Request): number {
  return (req as AuthedRequest).user!.userId;
}
function idParam(req: Request): number {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  return Number(raw);
}

/** Validates that an optional folderId belongs to the user. */
async function resolveFolder(
  userId: number,
  folderId: unknown,
): Promise<{ ok: true; id: number | null } | { ok: false }> {
  if (folderId == null || folderId === "") return { ok: true, id: null };
  const id = Number(folderId);
  if (!Number.isInteger(id)) return { ok: false };
  const folder = await prisma.folder.findFirst({ where: { id, userId } });
  return folder ? { ok: true, id } : { ok: false };
}

router.get("/templates", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  const where: { userId: number; folderId?: number | null } = { userId };
  const f = req.query.folderId;
  if (typeof f === "string") where.folderId = f === "null" || f === "" ? null : Number(f);
  res.json(await prisma.template.findMany({ where, orderBy: { name: "asc" } }));
});

router.get("/templates/:id", async (req: Request, res: Response) => {
  const t = await prisma.template.findFirst({
    where: { id: idParam(req), userId: userIdOf(req) },
  });
  if (!t) {
    res.status(404).json({ error: "Template not found." });
    return;
  }
  res.json(t);
});

router.post("/templates", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  const { name, svg, mode, folderId } = (req.body ?? {}) as Record<string, unknown>;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof svg !== "string" ||
    !svg.trim()
  ) {
    res.status(400).json({ error: "name and svg are required." });
    return;
  }
  const folder = await resolveFolder(userId, folderId);
  if (!folder.ok) {
    res.status(400).json({ error: "Invalid folderId." });
    return;
  }
  const t = await prisma.template.create({
    data: {
      userId,
      name: name.trim(),
      svg,
      mode: typeof mode === "string" ? mode : "current-song",
      folderId: folder.id,
    },
  });
  res.status(201).json(t);
});

router.put("/templates/:id", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  const id = idParam(req);
  const existing = await prisma.template.findFirst({ where: { id, userId } });
  if (!existing) {
    res.status(404).json({ error: "Template not found." });
    return;
  }
  const { name, svg, mode, folderId } = (req.body ?? {}) as Record<string, unknown>;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof svg !== "string" ||
    !svg.trim()
  ) {
    res.status(400).json({ error: "name and svg are required." });
    return;
  }
  const folder = await resolveFolder(userId, folderId);
  if (!folder.ok) {
    res.status(400).json({ error: "Invalid folderId." });
    return;
  }
  const t = await prisma.template.update({
    where: { id },
    data: {
      name: name.trim(),
      svg,
      mode: typeof mode === "string" ? mode : existing.mode,
      folderId: folder.id,
    },
  });
  res.json(t);
});

router.delete("/templates/:id", async (req: Request, res: Response) => {
  const r = await prisma.template.deleteMany({
    where: { id: idParam(req), userId: userIdOf(req) },
  });
  if (r.count === 0) {
    res.status(404).json({ error: "Template not found." });
    return;
  }
  res.status(204).end();
});

export default router;
