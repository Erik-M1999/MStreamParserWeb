import { describe, it, expect } from "vitest";
import { buildPaths, type ApiFolder } from "@/lib/imd/library";

// Unit tests for buildPaths: turns the backend's id/parentId folder rows into
// the "A/B/C" path view the Library renders. Pure logic — no DB/network.

describe("buildPaths", () => {
  // Edge case: empty input
  it("returns empty lookups for no folders", () => {
    const { paths, idToPath, pathToId } = buildPaths([]);
    expect(paths).toEqual([]);
    expect(idToPath.size).toBe(0);
    expect(pathToId.size).toBe(0);
  });

  // Normal case: flat root folders
  it("maps root folders to their bare name", () => {
    const folders: ApiFolder[] = [
      { id: 1, name: "Pop", parentId: null },
      { id: 2, name: "Rock", parentId: null },
    ];
    const { idToPath, pathToId } = buildPaths(folders);
    expect(idToPath.get(1)).toBe("Pop");
    expect(pathToId.get("Rock")).toBe(2);
  });

  // Normal case: nested folders join with "/"
  it("builds slash-joined paths for nested folders (any array order)", () => {
    const folders: ApiFolder[] = [
      { id: 3, name: "C", parentId: 2 },
      { id: 1, name: "A", parentId: null },
      { id: 2, name: "B", parentId: 1 },
    ];
    const { idToPath } = buildPaths(folders);
    expect(idToPath.get(3)).toBe("A/B/C");
  });

  it("keeps pathToId the exact inverse of idToPath", () => {
    const folders: ApiFolder[] = [
      { id: 1, name: "A", parentId: null },
      { id: 2, name: "B", parentId: 1 },
    ];
    const { idToPath, pathToId } = buildPaths(folders);
    for (const [id, path] of idToPath) expect(pathToId.get(path)).toBe(id);
  });

  // Error/odd case: a folder whose parent no longer exists falls back to root
  it("treats a folder with a missing parent as a root folder", () => {
    const folders: ApiFolder[] = [{ id: 5, name: "Orphan", parentId: 999 }];
    const { idToPath } = buildPaths(folders);
    expect(idToPath.get(5)).toBe("Orphan");
  });
});
