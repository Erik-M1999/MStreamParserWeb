"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CurrentSongMode from "./CurrentSongMode";
import PlaylistMode from "./PlaylistMode";
import QueueMode from "./QueueMode";
import TemplateLibrary from "./TemplateLibrary";
import { type PendingTemplate } from "./ModeWorkspace";
import type { ImdDragPayload } from "@/features/imd/lib/dragPayload";
import * as lib from "@/features/imd/lib/library";
import { type ApiFolder, type ApiTemplate, buildPaths } from "@/features/imd/lib/library";

type Mode = "current-song" | "playlist" | "queue";

const TABS: { id: Mode; label: string }[] = [
  { id: "current-song", label: "Current Song" },
  { id: "playlist", label: "Playlist" },
  { id: "queue", label: "Queue" },
];

// Path helpers (the Library keys folders by their "A/B/C" path).
const lastSegment = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const parentPath = (p: string) => {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
};

export default function ImmersiveDisplayTool({
  connected,
  loggedIn,
}: {
  connected: boolean;
  loggedIn: boolean;
}) {
  const [mode, setMode] = useState<Mode>("current-song");
  const [pending, setPending] = useState<PendingTemplate | null>(null);

  // Per-user library, loaded from the backend (id-based; see lib/imd/library).
  const [folders, setFolders] = useState<ApiFolder[]>([]);
  const [templates, setTemplates] = useState<ApiTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [justSavedId, setJustSavedId] = useState<string | null>(null);
  const [justCreatedFolder, setJustCreatedFolder] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [f, t] = await Promise.all([lib.loadFolders(), lib.loadTemplates()]);
    setFolders(f);
    setTemplates(t);
  }, []);

  // Load the user's library once logged in (anon only ever sees _debug).
  useEffect(() => {
    if (!loggedIn) {
      setFolders([]);
      setTemplates([]);
      return;
    }
    reload().catch(() => setError("Couldn't load your library."));
  }, [loggedIn, reload]);

  // Derive the path-based view the Library component consumes.
  const { pathToId, idToPath, paths } = useMemo(() => buildPaths(folders), [folders]);
  const userFolders = paths;
  const userTemplates = useMemo(
    () =>
      templates.map((t) => ({
        id: String(t.id),
        name: t.name,
        svg: t.svg,
        folder: t.folderId != null ? (idToPath.get(t.folderId) ?? "") : "",
        modes: [t.mode],
      })),
    [templates, idToPath],
  );

  // Mutations require a login; a logged-out attempt bounces to /login.
  function ensureAuth(): boolean {
    if (loggedIn) return true;
    window.location.href = "/login";
    return false;
  }
  // Runs an async mutation, then refreshes state; surfaces a short error.
  async function run(fn: () => Promise<void>) {
    if (!ensureAuth()) return;
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  const folderIdOf = (path: string): number | null =>
    path ? (pathToId.get(path) ?? null) : null;

  function newFolder(parent: string | null) {
    void run(async () => {
      const parentId = parent ? folderIdOf(parent) : null;
      const siblings = new Set(
        folders.filter((f) => f.parentId === parentId).map((f) => f.name),
      );
      let name = "New folder";
      for (let i = 2; siblings.has(name); i++) name = `New folder ${i}`;
      await lib.createFolder(name, parentId);
      await reload();
      setJustCreatedFolder(parent ? `${parent}/${name}` : name);
    });
  }

  function saveToFolder(folder: string, payload: ImdDragPayload) {
    if (!payload.svg) return; // only inline SVGs (from the workspace) are savable
    void run(async () => {
      const created = await lib.createTemplate({
        name: payload.name || "template",
        svg: payload.svg!,
        mode: payload.modes[0] ?? "current-song",
        folderId: folderIdOf(folder),
      });
      await reload();
      setJustSavedId(String(created.id));
    });
  }

  function renameTemplate(id: string, name: string) {
    const t = templates.find((x) => x.id === Number(id));
    if (!t) return;
    void run(async () => {
      await lib.updateTemplate(t.id, {
        name,
        svg: t.svg,
        mode: t.mode,
        folderId: t.folderId,
      });
      await reload();
    });
  }

  function renameFolder(path: string, rawName: string) {
    const name = rawName.trim();
    if (!name || name.includes("/")) return;
    const id = folderIdOf(path);
    const f = folders.find((x) => x.id === id);
    if (id == null || !f) return;
    // No-op if a sibling already has that name (would collide on path).
    const clash = folders.some(
      (s) => s.parentId === f.parentId && s.id !== id && s.name === name,
    );
    if (clash || name === f.name) return;
    void run(async () => {
      await lib.updateFolder(id, name, f.parentId);
      await reload();
    });
  }

  function deleteFolder(path: string) {
    const id = folderIdOf(path);
    if (id == null) return;
    void run(async () => {
      await lib.deleteFolder(id); // cascades to children + their templates
      await reload();
    });
  }

  function deleteTemplate(id: string) {
    void run(async () => {
      await lib.deleteTemplate(Number(id));
      await reload();
    });
  }

  function moveTemplate(id: string, folder: string) {
    const t = templates.find((x) => x.id === Number(id));
    if (!t) return;
    void run(async () => {
      await lib.updateTemplate(t.id, {
        name: t.name,
        svg: t.svg,
        mode: t.mode,
        folderId: folderIdOf(folder),
      });
      await reload();
    });
  }

  function moveFolder(src: string, destParent: string) {
    // Can't drop a folder into itself or one of its descendants.
    if (destParent === src || destParent.startsWith(`${src}/`)) return;
    const id = folderIdOf(src);
    const f = folders.find((x) => x.id === id);
    if (id == null || !f) return;
    const destId = destParent ? folderIdOf(destParent) : null;
    // No-op if the destination already has a folder with this name.
    const clash = folders.some(
      (s) => s.parentId === destId && s.id !== id && s.name === f.name,
    );
    if (clash) return;
    void run(async () => {
      await lib.updateFolder(id, f.name, destId);
      await reload();
    });
  }

  // Bulk paste: create folders parents-first (resolving ids as we go), then the
  // templates inside them. Uses a fresh folder snapshot to avoid stale ids.
  function pasteSubtree(spec: {
    folders: string[];
    templates: { folder: string; name: string; modes: string[]; svg: string }[];
  }) {
    void run(async () => {
      const map = new Map(buildPaths(await lib.loadFolders()).pathToId);
      const ordered = [...spec.folders].sort(
        (a, b) => a.split("/").length - b.split("/").length,
      );
      for (const path of ordered) {
        const pp = parentPath(path);
        const created = await lib.createFolder(
          lastSegment(path),
          pp ? (map.get(pp) ?? null) : null,
        );
        map.set(path, created.id);
      }
      for (const t of spec.templates) {
        await lib.createTemplate({
          name: t.name,
          svg: t.svg,
          mode: t.modes[0] ?? "current-song",
          folderId: t.folder ? (map.get(t.folder) ?? null) : null,
        });
      }
      await reload();
    });
  }

  async function loadInto(
    modes: string[],
    name: string,
    resolveSvg: () => Promise<string | null>,
  ) {
    const targetMode = (modes[0] as Mode) ?? "current-song";
    setMode(targetMode);
    const svg = await resolveSvg();
    if (svg != null) {
      setPending({ token: Date.now(), name, svg, mode: targetMode });
    }
  }

  return (
    <div className="flex gap-4">
      <TemplateLibrary
        currentMode={mode}
        userFolders={userFolders}
        userTemplates={userTemplates}
        loggedIn={loggedIn}
        justSavedId={justSavedId}
        onClearJustSaved={() => setJustSavedId(null)}
        justCreatedFolder={justCreatedFolder}
        onClearJustCreatedFolder={() => setJustCreatedFolder(null)}
        onNewFolder={newFolder}
        onSaveToFolder={saveToFolder}
        onRenameTemplate={renameTemplate}
        onRenameFolder={renameFolder}
        onDeleteFolder={deleteFolder}
        onDeleteTemplate={deleteTemplate}
        onMoveTemplate={moveTemplate}
        onMoveFolder={moveFolder}
        onPaste={pasteSubtree}
        onLoad={loadInto}
      />

      <div className="min-w-0 flex-1 space-y-5">
        {error && (
          <p className="rounded-md border border-error bg-error-container px-3 py-2 text-sm text-error">
            {error}
          </p>
        )}

        <div className="flex gap-1 rounded-lg border border-outline-variant bg-surface-container-low p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMode(tab.id)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === tab.id
                  ? "bg-primary text-on-primary"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className={mode === "current-song" ? "" : "hidden"}>
          <CurrentSongMode
            connected={connected}
            loggedIn={loggedIn}
            pendingTemplate={pending}
          />
        </div>
        <div className={mode === "playlist" ? "" : "hidden"}>
          <PlaylistMode
            connected={connected}
            loggedIn={loggedIn}
            pendingTemplate={pending}
          />
        </div>
        <div className={mode === "queue" ? "" : "hidden"}>
          <QueueMode
            connected={connected}
            loggedIn={loggedIn}
            pendingTemplate={pending}
          />
        </div>
      </div>
    </div>
  );
}
