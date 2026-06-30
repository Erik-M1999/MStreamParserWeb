// Client data layer for the per-user template Library. Folders/templates live
// in the backend (id-based, parentId / folderId); this module talks to the CRUD
// routes and converts the id-tree into the path-based view the Library renders.

import { authJson } from "@/shared/lib/authFetch";

export interface ApiFolder {
  id: number;
  name: string;
  parentId: number | null;
}

export interface ApiTemplate {
  id: number;
  name: string;
  svg: string;
  mode: string;
  folderId: number | null;
}

// --- Reads ----------------------------------------------------------------
export function loadFolders(): Promise<ApiFolder[]> {
  return authJson<ApiFolder[]>("/api/folders");
}
export function loadTemplates(): Promise<ApiTemplate[]> {
  return authJson<ApiTemplate[]>("/api/templates");
}

// --- Folder writes --------------------------------------------------------
export function createFolder(name: string, parentId: number | null): Promise<ApiFolder> {
  return authJson<ApiFolder>("/api/folders", {
    method: "POST",
    body: JSON.stringify({ name, parentId }),
  });
}
export function updateFolder(id: number, name: string, parentId: number | null): Promise<ApiFolder> {
  return authJson<ApiFolder>(`/api/folders/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name, parentId }),
  });
}
export function deleteFolder(id: number): Promise<void> {
  return authJson<void>(`/api/folders/${id}`, { method: "DELETE" });
}

// --- Template writes ------------------------------------------------------
export interface TemplateInput {
  name: string;
  svg: string;
  mode: string;
  folderId: number | null;
}
export function createTemplate(t: TemplateInput): Promise<ApiTemplate> {
  return authJson<ApiTemplate>("/api/templates", {
    method: "POST",
    body: JSON.stringify(t),
  });
}
export function updateTemplate(id: number, t: TemplateInput): Promise<ApiTemplate> {
  return authJson<ApiTemplate>(`/api/templates/${id}`, {
    method: "PUT",
    body: JSON.stringify(t),
  });
}
export function deleteTemplate(id: number): Promise<void> {
  return authJson<void>(`/api/templates/${id}`, { method: "DELETE" });
}

// --- id <-> path mapping --------------------------------------------------
// A folder's path is parentPath + "/" + name (siblings are kept unique by the
// UI). Returns lookups in both directions plus the flat list of all paths.
export interface FolderPaths {
  idToPath: Map<number, string>;
  pathToId: Map<string, number>;
  paths: string[];
}

export function buildPaths(folders: ApiFolder[]): FolderPaths {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const idToPath = new Map<number, string>();

  const resolve = (f: ApiFolder): string => {
    const cached = idToPath.get(f.id);
    if (cached) return cached;
    const parent = f.parentId != null ? byId.get(f.parentId) : undefined;
    const path = parent ? `${resolve(parent)}/${f.name}` : f.name;
    idToPath.set(f.id, path);
    return path;
  };

  for (const f of folders) resolve(f);

  const pathToId = new Map<string, number>();
  for (const [id, path] of idToPath) pathToId.set(path, id);
  return { idToPath, pathToId, paths: [...idToPath.values()] };
}
