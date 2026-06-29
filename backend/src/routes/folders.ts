import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { authenticate, type AuthedRequest } from "./auth.js";

// Per-user folder CRUD (self-nesting via parentId). Scoped to the user.

const router = Router();
router.use(authenticate);

function userIdOf(req: Request): number {
  return (req as AuthedRequest).user!.userId;
}
function idParam(req: Request): number {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  return Number(raw);
}

async function resolveParent(
  userId: number,
  parentId: unknown,
): Promise<{ ok: true; id: number | null } | { ok: false }> {
  if (parentId == null || parentId === "") return { ok: true, id: null };
  const id = Number(parentId);
  if (!Number.isInteger(id)) return { ok: false };
  const parent = await prisma.folder.findFirst({ where: { id, userId } });
  return parent ? { ok: true, id } : { ok: false };
}

router.get("/folders", async (req: Request, res: Response) => {
  res.json(
    await prisma.folder.findMany({
      where: { userId: userIdOf(req) },
      orderBy: { name: "asc" },
    }),
  );
});

router.get("/folders/:id", async (req: Request, res: Response) => {
  const f = await prisma.folder.findFirst({
    where: { id: idParam(req), userId: userIdOf(req) },
  });
  if (!f) {
    res.status(404).json({ error: "Folder not found." });
    return;
  }
  res.json(f);
});

// Bonus nested resource: the templates inside a folder.
router.get("/folders/:id/templates", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  const id = idParam(req);
  const folder = await prisma.folder.findFirst({ where: { id, userId } });
  if (!folder) {
    res.status(404).json({ error: "Folder not found." });
    return;
  }
  res.json(
    await prisma.template.findMany({
      where: { userId, folderId: id },
      orderBy: { name: "asc" },
    }),
  );
});

router.post("/folders", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  const { name, parentId } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required." });
    return;
  }
  const parent = await resolveParent(userId, parentId);
  if (!parent.ok) {
    res.status(400).json({ error: "Invalid parentId." });
    return;
  }
  const f = await prisma.folder.create({
    data: { userId, name: name.trim(), parentId: parent.id },
  });
  res.status(201).json(f);
});

router.put("/folders/:id", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  const id = idParam(req);
  const existing = await prisma.folder.findFirst({ where: { id, userId } });
  if (!existing) {
    res.status(404).json({ error: "Folder not found." });
    return;
  }
  const { name, parentId } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required." });
    return;
  }
  const parent = await resolveParent(userId, parentId);
  if (!parent.ok) {
    res.status(400).json({ error: "Invalid parentId." });
    return;
  }
  if (parent.id === id) {
    res.status(400).json({ error: "A folder can't be its own parent." });
    return;
  }
  const f = await prisma.folder.update({
    where: { id },
    data: { name: name.trim(), parentId: parent.id },
  });
  res.json(f);
});

router.delete("/folders/:id", async (req: Request, res: Response) => {
  // Cascades to child folders + their templates (see schema onDelete: Cascade).
  const r = await prisma.folder.deleteMany({
    where: { id: idParam(req), userId: userIdOf(req) },
  });
  if (r.count === 0) {
    res.status(404).json({ error: "Folder not found." });
    return;
  }
  res.status(204).end();
});

export default router;
