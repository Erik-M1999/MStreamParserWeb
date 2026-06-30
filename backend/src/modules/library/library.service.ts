import { prisma } from "../../db.js";
import { HttpError } from "../../shared/errors.js";

// ---------------------------------------------------------------------------
// Library context: the user's saved folders + templates. Folder and Template
// live in ONE context, so the service may touch both tables freely; nothing
// outside this module accesses them directly.
//
// Every function is scoped by userId (ownership) and throws HttpError for
// expected failures (400 validation, 404 not-found). Routes stay thin.
//
// Public:   listTemplates, getTemplate, createTemplate, updateTemplate,
//           deleteTemplate, listFolders, getFolder, listFolderTemplates,
//           createFolder, updateFolder, deleteFolder
// Internal: parseTemplateBody, parseFolderName, resolveFolder, resolveParent
// ---------------------------------------------------------------------------

type Body = Record<string, unknown>;

// --- internal validation helpers ------------------------------------------

function parseTemplateBody(body: Body): { name: string; svg: string; mode?: string } {
  const { name, svg, mode } = body;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof svg !== "string" ||
    !svg.trim()
  ) {
    throw new HttpError(400, "name and svg are required.");
  }
  return { name: name.trim(), svg, mode: typeof mode === "string" ? mode : undefined };
}

function parseFolderName(name: unknown): string {
  if (typeof name !== "string" || !name.trim()) {
    throw new HttpError(400, "name is required.");
  }
  return name.trim();
}

/** Validates an optional folderId belongs to the user; returns its id or null. */
async function resolveFolder(userId: number, folderId: unknown): Promise<number | null> {
  if (folderId == null || folderId === "") return null;
  const id = Number(folderId);
  if (!Number.isInteger(id)) throw new HttpError(400, "Invalid folderId.");
  const folder = await prisma.folder.findFirst({ where: { id, userId } });
  if (!folder) throw new HttpError(400, "Invalid folderId.");
  return id;
}

/** Validates an optional parentId belongs to the user; returns its id or null. */
async function resolveParent(userId: number, parentId: unknown): Promise<number | null> {
  if (parentId == null || parentId === "") return null;
  const id = Number(parentId);
  if (!Number.isInteger(id)) throw new HttpError(400, "Invalid parentId.");
  const parent = await prisma.folder.findFirst({ where: { id, userId } });
  if (!parent) throw new HttpError(400, "Invalid parentId.");
  return id;
}

// --- templates ------------------------------------------------------------

export function listTemplates(userId: number, folderIdQuery?: string) {
  const where: { userId: number; folderId?: number | null } = { userId };
  if (typeof folderIdQuery === "string") {
    where.folderId =
      folderIdQuery === "null" || folderIdQuery === "" ? null : Number(folderIdQuery);
  }
  return prisma.template.findMany({ where, orderBy: { name: "asc" } });
}

export async function getTemplate(userId: number, id: number) {
  const t = await prisma.template.findFirst({ where: { id, userId } });
  if (!t) throw new HttpError(404, "Template not found.");
  return t;
}

export async function createTemplate(userId: number, body: Body) {
  const { name, svg, mode } = parseTemplateBody(body);
  const folderId = await resolveFolder(userId, body.folderId);
  return prisma.template.create({
    data: { userId, name, svg, mode: mode ?? "current-song", folderId },
  });
}

export async function updateTemplate(userId: number, id: number, body: Body) {
  const existing = await prisma.template.findFirst({ where: { id, userId } });
  if (!existing) throw new HttpError(404, "Template not found.");
  const { name, svg, mode } = parseTemplateBody(body);
  const folderId = await resolveFolder(userId, body.folderId);
  return prisma.template.update({
    where: { id },
    data: { name, svg, mode: mode ?? existing.mode, folderId },
  });
}

export async function deleteTemplate(userId: number, id: number): Promise<void> {
  const r = await prisma.template.deleteMany({ where: { id, userId } });
  if (r.count === 0) throw new HttpError(404, "Template not found.");
}

// --- folders --------------------------------------------------------------

export function listFolders(userId: number) {
  return prisma.folder.findMany({ where: { userId }, orderBy: { name: "asc" } });
}

export async function getFolder(userId: number, id: number) {
  const f = await prisma.folder.findFirst({ where: { id, userId } });
  if (!f) throw new HttpError(404, "Folder not found.");
  return f;
}

export async function listFolderTemplates(userId: number, id: number) {
  await getFolder(userId, id); // 404 if the folder isn't the user's
  return prisma.template.findMany({
    where: { userId, folderId: id },
    orderBy: { name: "asc" },
  });
}

export async function createFolder(userId: number, body: Body) {
  const name = parseFolderName(body.name);
  const parentId = await resolveParent(userId, body.parentId);
  return prisma.folder.create({ data: { userId, name, parentId } });
}

export async function updateFolder(userId: number, id: number, body: Body) {
  const existing = await prisma.folder.findFirst({ where: { id, userId } });
  if (!existing) throw new HttpError(404, "Folder not found.");
  const name = parseFolderName(body.name);
  const parentId = await resolveParent(userId, body.parentId);
  if (parentId === id) throw new HttpError(400, "A folder can't be its own parent.");
  return prisma.folder.update({ where: { id }, data: { name, parentId } });
}

export async function deleteFolder(userId: number, id: number): Promise<void> {
  // Cascades to child folders + their templates (schema onDelete: Cascade).
  const r = await prisma.folder.deleteMany({ where: { id, userId } });
  if (r.count === 0) throw new HttpError(404, "Folder not found.");
}
