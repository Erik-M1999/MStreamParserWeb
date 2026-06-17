"use client";

import { useState } from "react";
import CurrentSongMode from "./CurrentSongMode";
import PlaylistMode from "./PlaylistMode";
import QueueMode from "./QueueMode";
import TemplateLibrary from "./TemplateLibrary";
import { type PendingTemplate } from "./ModeWorkspace";
import type { ImdDragPayload } from "@/lib/imd/dragPayload";

type Mode = "current-song" | "playlist" | "queue";

const TABS: { id: Mode; label: string }[] = [
  { id: "current-song", label: "Current Song" },
  { id: "playlist", label: "Playlist" },
  { id: "queue", label: "Queue" },
];

export interface UserTemplate {
  id: string;
  name: string;
  svg: string;
  folder: string; // "" = root
  modes: string[];
}

export default function ImmersiveDisplayTool({
  connected,
}: {
  connected: boolean;
}) {
  const [mode, setMode] = useState<Mode>("current-song");
  const [pending, setPending] = useState<PendingTemplate | null>(null);

  // Client-side library state (ephemeral until users + DB exist).
  const [userFolders, setUserFolders] = useState<string[]>([]);
  const [userTemplates, setUserTemplates] = useState<UserTemplate[]>([]);
  const [justSavedId, setJustSavedId] = useState<string | null>(null);
  const [justCreatedFolder, setJustCreatedFolder] = useState<string | null>(null);

  function newFolder(parent: string | null) {
    const makePath = (n: string) => (parent ? `${parent}/${n}` : n);
    let name = "New folder";
    let i = 2;
    while (userFolders.includes(makePath(name))) name = `New folder ${i++}`;
    const path = makePath(name);
    setUserFolders((f) => [...f, path]);
    setJustCreatedFolder(path); // triggers immediate inline rename in the Library
  }

  function saveToFolder(folder: string, payload: ImdDragPayload) {
    if (!payload.svg) return; // only inline SVGs (from the workspace) are savable
    const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setUserTemplates((t) => [
      ...t,
      { id, name: payload.name || "template", svg: payload.svg!, folder, modes: payload.modes },
    ]);
    setJustSavedId(id); // triggers inline rename in the Library
  }

  function renameTemplate(id: string, name: string) {
    setUserTemplates((t) => t.map((x) => (x.id === id ? { ...x, name } : x)));
  }

  function renameFolder(oldPath: string, rawName: string) {
    const name = rawName.trim();
    if (!name || name.includes("/")) return;
    const i = oldPath.lastIndexOf("/");
    const parent = i === -1 ? "" : oldPath.slice(0, i);
    const newPath = parent ? `${parent}/${name}` : name;
    if (newPath === oldPath || userFolders.includes(newPath)) return;
    const remap = (p: string) =>
      p === oldPath
        ? newPath
        : p.startsWith(`${oldPath}/`)
          ? newPath + p.slice(oldPath.length)
          : p;
    setUserFolders((fs) => fs.map(remap));
    setUserTemplates((ts) => ts.map((t) => ({ ...t, folder: remap(t.folder) })));
  }

  function deleteFolder(path: string) {
    setUserFolders((fs) =>
      fs.filter((f) => f !== path && !f.startsWith(`${path}/`)),
    );
    setUserTemplates((ts) =>
      ts.filter((t) => t.folder !== path && !t.folder.startsWith(`${path}/`)),
    );
  }

  function deleteTemplate(id: string) {
    setUserTemplates((t) => t.filter((x) => x.id !== id));
  }

  function moveTemplate(id: string, folder: string) {
    setUserTemplates((ts) => ts.map((t) => (t.id === id ? { ...t, folder } : t)));
  }

  function moveFolder(src: string, destParent: string) {
    if (src === "_debug") return;
    // Can't drop a folder into itself or one of its descendants.
    if (destParent === src || destParent.startsWith(`${src}/`)) return;
    const name = src.slice(src.lastIndexOf("/") + 1);
    const newPath = destParent ? `${destParent}/${name}` : name;
    if (newPath === src || userFolders.includes(newPath)) return;
    const remap = (p: string) =>
      p === src
        ? newPath
        : p.startsWith(`${src}/`)
          ? newPath + p.slice(src.length)
          : p;
    setUserFolders((fs) => fs.map(remap));
    setUserTemplates((ts) => ts.map((t) => ({ ...t, folder: remap(t.folder) })));
  }

  function addFolders(paths: string[]) {
    setUserFolders((fs) => Array.from(new Set([...fs, ...paths])));
  }

  function addTemplates(
    items: { name: string; svg: string; folder: string; modes: string[] }[],
  ) {
    setUserTemplates((ts) => [
      ...ts,
      ...items.map((it, i) => ({
        id: `user-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
        ...it,
      })),
    ]);
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
        onAddFolders={addFolders}
        onAddTemplates={addTemplates}
        onLoad={loadInto}
      />

      <div className="min-w-0 flex-1 space-y-5">
        <div className="flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900/50 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMode(tab.id)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === tab.id
                  ? "bg-neutral-100 text-neutral-900"
                  : "text-neutral-400 hover:text-neutral-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className={mode === "current-song" ? "" : "hidden"}>
          <CurrentSongMode connected={connected} pendingTemplate={pending} />
        </div>
        <div className={mode === "playlist" ? "" : "hidden"}>
          <PlaylistMode connected={connected} pendingTemplate={pending} />
        </div>
        <div className={mode === "queue" ? "" : "hidden"}>
          <QueueMode connected={connected} pendingTemplate={pending} />
        </div>
      </div>
    </div>
  );
}
