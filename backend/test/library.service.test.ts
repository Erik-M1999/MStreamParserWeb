import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db";
import * as library from "../src/modules/library/library.service";

// Real-DB tests for the Library service (folders + templates). Uses dev.db like
// routes.integration.test.ts: a throwaway user created in beforeAll, removed
// (cascading to its rows) in afterAll.

const tag = Date.now().toString(36);
let userId: number;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: `lib_${tag}@itest.local`, username: `lib_${tag}`, passwordHash: "x" },
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("library: folders", () => {
  it("creates, lists, renames and deletes a folder", async () => {
    const f = await library.createFolder(userId, { name: "  Rock  " });
    expect(f.name).toBe("Rock"); // trimmed

    const folders = await library.listFolders(userId);
    expect(folders.some((x) => x.id === f.id)).toBe(true);
    expect(await library.getFolder(userId, f.id)).toMatchObject({ id: f.id });

    const renamed = await library.updateFolder(userId, f.id, { name: "Metal" });
    expect(renamed.name).toBe("Metal");

    await library.deleteFolder(userId, f.id);
    await expect(library.getFolder(userId, f.id)).rejects.toMatchObject({ status: 404 });
  });

  it("supports nested folders via parentId", async () => {
    const parent = await library.createFolder(userId, { name: "Parent" });
    const child = await library.createFolder(userId, { name: "Child", parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
    await library.deleteFolder(userId, parent.id); // cascades to child
    await expect(library.getFolder(userId, child.id)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a blank name (400)", async () => {
    await expect(library.createFolder(userId, { name: "   " })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an invalid parentId (400)", async () => {
    await expect(
      library.createFolder(userId, { name: "x", parentId: 999999 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses to make a folder its own parent (400)", async () => {
    const f = await library.createFolder(userId, { name: "self" });
    await expect(
      library.updateFolder(userId, f.id, { name: "self", parentId: f.id }),
    ).rejects.toMatchObject({ status: 400 });
    await library.deleteFolder(userId, f.id);
  });

  it("404s updating/deleting a non-existent folder", async () => {
    await expect(library.updateFolder(userId, 999999, { name: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(library.deleteFolder(userId, 999999)).rejects.toMatchObject({ status: 404 });
  });
});

describe("library: templates", () => {
  it("creates a template with a default mode and lists it back", async () => {
    const t = await library.createTemplate(userId, { name: "T1", svg: SVG });
    expect(t.mode).toBe("current-song"); // default
    const all = await library.listTemplates(userId);
    expect(all.some((x) => x.id === t.id)).toBe(true);
    await library.deleteTemplate(userId, t.id);
  });

  it("scopes templates to a folder and filters by folderId", async () => {
    const folder = await library.createFolder(userId, { name: "Box" });
    const inFolder = await library.createTemplate(userId, { name: "In", svg: SVG, folderId: folder.id });
    const loose = await library.createTemplate(userId, { name: "Loose", svg: SVG });

    const byFolder = await library.listTemplates(userId, String(folder.id));
    expect(byFolder.map((t) => t.id)).toContain(inFolder.id);
    expect(byFolder.map((t) => t.id)).not.toContain(loose.id);

    const rootOnly = await library.listTemplates(userId, "null");
    expect(rootOnly.map((t) => t.id)).toContain(loose.id);
    expect(rootOnly.map((t) => t.id)).not.toContain(inFolder.id);

    const folderTemplates = await library.listFolderTemplates(userId, folder.id);
    expect(folderTemplates.map((t) => t.id)).toEqual([inFolder.id]);

    await library.deleteFolder(userId, folder.id);
    await library.deleteTemplate(userId, loose.id);
  });

  it("updates a template and keeps its mode when none is given", async () => {
    const t = await library.createTemplate(userId, { name: "Up", svg: SVG, mode: "queue" });
    const updated = await library.updateTemplate(userId, t.id, { name: "Up2", svg: SVG });
    expect(updated.name).toBe("Up2");
    expect(updated.mode).toBe("queue"); // preserved
    await library.deleteTemplate(userId, t.id);
  });

  it("builds folder paths in listTemplatesWithPath", async () => {
    const a = await library.createFolder(userId, { name: "A" });
    const b = await library.createFolder(userId, { name: "B", parentId: a.id });
    const t = await library.createTemplate(userId, { name: "Deep", svg: SVG, folderId: b.id });

    const list = await library.listTemplatesWithPath(userId);
    const row = list.find((x) => x.id === t.id)!;
    expect(row.path).toBe("A/B");

    await library.deleteFolder(userId, a.id);
  });

  it("rejects a template with missing name/svg (400)", async () => {
    await expect(library.createTemplate(userId, { name: "", svg: SVG })).rejects.toMatchObject({ status: 400 });
    await expect(library.createTemplate(userId, { name: "x", svg: "" })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an invalid folderId (400)", async () => {
    await expect(
      library.createTemplate(userId, { name: "x", svg: SVG, folderId: 999999 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("404s on get/update/delete of a non-existent template", async () => {
    await expect(library.getTemplate(userId, 999999)).rejects.toMatchObject({ status: 404 });
    await expect(library.updateTemplate(userId, 999999, { name: "x", svg: SVG })).rejects.toMatchObject({ status: 404 });
    await expect(library.deleteTemplate(userId, 999999)).rejects.toMatchObject({ status: 404 });
  });

  it("404s listing templates of a non-existent folder", async () => {
    await expect(library.listFolderTemplates(userId, 999999)).rejects.toMatchObject({ status: 404 });
  });
});
