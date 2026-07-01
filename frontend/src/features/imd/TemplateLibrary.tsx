"use client";

import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";
import { BACKEND_URL } from "@/shared/config";
import { IMD_DND_MIME, type ImdDragPayload } from "@/features/imd/lib/dragPayload";

interface DebugTemplate {
  id: string;
  name: string;
  folder: string;
  modes: string[];
  readOnly: boolean;
}

interface UserTemplate {
  id: string;
  name: string;
  svg: string;
  folder: string;
  modes: string[];
}

interface LibTemplate {
  key: string;
  name: string;
  modes: string[];
  readOnly: boolean;
  backendId?: string;
  svg?: string;
}

interface Menu {
  x: number;
  y: number;
  kind: "folder" | "template" | "root";
  key?: string;
}

type Clipboard =
  | { kind: "template"; name: string; modes: string[]; svg: string }
  | {
      kind: "folder";
      name: string;
      folders: string[]; // sub-paths relative to the copied folder
      templates: { folder: string; name: string; modes: string[]; svg: string }[];
    };

const MODE_LABEL: Record<string, string> = {
  "current-song": "Song",
  playlist: "Playlist",
  queue: "Queue",
};

function folderName(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

// Alphabetical, case-insensitive, with symbols/punctuation before letters/digits
// (so "_debug" sorts before "New folder").
function compareNames(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  const alnum = (c: string) =>
    (c >= "a" && c <= "z") || (c >= "0" && c <= "9");
  const n = Math.min(al.length, bl.length);
  for (let i = 0; i < n; i++) {
    if (al[i] === bl[i]) continue;
    const ra = alnum(al[i]) ? 1 : 0;
    const rb = alnum(bl[i]) ? 1 : 0;
    if (ra !== rb) return ra - rb;
    return al[i] < bl[i] ? -1 : 1;
  }
  return al.length - bl.length;
}

export default function TemplateLibrary({
  currentMode,
  userFolders,
  userTemplates,
  loggedIn,
  justSavedId,
  onClearJustSaved,
  justCreatedFolder,
  onClearJustCreatedFolder,
  onNewFolder,
  onSaveToFolder,
  onRenameTemplate,
  onRenameFolder,
  onDeleteFolder,
  onDeleteTemplate,
  onMoveTemplate,
  onMoveFolder,
  onPaste,
  onLoad,
}: {
  currentMode: string;
  userFolders: string[];
  userTemplates: UserTemplate[];
  loggedIn: boolean;
  justSavedId: string | null;
  onClearJustSaved: () => void;
  justCreatedFolder: string | null;
  onClearJustCreatedFolder: () => void;
  onNewFolder: (parent: string | null) => void;
  onSaveToFolder: (folder: string, payload: ImdDragPayload) => void;
  onRenameTemplate: (id: string, name: string) => void;
  onRenameFolder: (path: string, name: string) => void;
  onDeleteFolder: (path: string) => void;
  onDeleteTemplate: (id: string) => void;
  onMoveTemplate: (id: string, folder: string) => void;
  onMoveFolder: (src: string, destParent: string) => void;
  onPaste: (spec: {
    folders: string[];
    templates: { folder: string; name: string; modes: string[]; svg: string }[];
  }) => void;
  onLoad: (
    modes: string[],
    name: string,
    resolveSvg: () => Promise<string | null>,
  ) => void;
}) {
  const [debug, setDebug] = useState<DebugTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({}); // _debug collapsed
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [selected, setSelected] = useState<{
    type: "folder" | "template";
    key: string;
  } | null>(null);
  const [renaming, setRenaming] = useState<{
    kind: "folder" | "template";
    key: string;
  } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/sample-templates`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d: DebugTemplate[]) => setDebug(d))
      .catch(() => setError("Couldn't load templates."));
  }, []);

  // Close the context menu on any outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const allFolders = useMemo(() => ["_debug", ...userFolders], [userFolders]);

  function openAncestors(folder: string) {
    if (!folder) return;
    const parts = folder.split("/");
    setOpen((o) => {
      const n = { ...o };
      for (let i = 0; i < parts.length; i++) {
        n[parts.slice(0, i + 1).join("/")] = true;
      }
      return n;
    });
  }

  // When a template is saved (dropped into a folder), reveal + rename it.
  useEffect(() => {
    if (!justSavedId) return;
    const t = userTemplates.find((x) => x.id === justSavedId);
    if (t) {
      openAncestors(t.folder);
      setSelected({ type: "template", key: justSavedId });
      setRenaming({ kind: "template", key: justSavedId });
      setRenameValue(t.name);
    }
    onClearJustSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justSavedId]);

  // A newly created folder is immediately renameable; bailing keeps its default.
  useEffect(() => {
    if (!justCreatedFolder) return;
    openAncestors(justCreatedFolder);
    setSelected({ type: "folder", key: justCreatedFolder });
    setRenaming({ kind: "folder", key: justCreatedFolder });
    setRenameValue(folderName(justCreatedFolder));
    onClearJustCreatedFolder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justCreatedFolder]);

  function childFolders(parent: string | null): string[] {
    return allFolders
      .filter((p) => {
        const i = p.lastIndexOf("/");
        const par = i === -1 ? null : p.slice(0, i);
        return par === parent;
      })
      .sort((a, b) => compareNames(folderName(a), folderName(b)));
  }

  function templatesIn(folder: string): LibTemplate[] {
    const list =
      folder === "_debug"
        ? debug.map((d) => ({
            key: d.id,
            name: d.name,
            modes: d.modes,
            readOnly: true,
            backendId: d.id,
          }))
        : userTemplates
            .filter((t) => t.folder === folder)
            .map((t) => ({
              key: t.id,
              name: t.name,
              modes: t.modes,
              readOnly: false,
              svg: t.svg,
            }));
    return list.sort((a, b) => compareNames(a.name, b.name));
  }

  function findTemplate(key: string): LibTemplate | null {
    const u = userTemplates.find((t) => t.id === key);
    if (u) return { key: u.id, name: u.name, modes: u.modes, readOnly: false, svg: u.svg };
    const d = debug.find((t) => t.id === key);
    if (d) return { key: d.id, name: d.name, modes: d.modes, readOnly: true, backendId: d.id };
    return null;
  }

  async function resolveSvg(t: LibTemplate): Promise<string | null> {
    if (t.svg != null) return t.svg;
    if (t.backendId) {
      const r = await fetch(
        `${BACKEND_URL}/api/sample-templates/${encodeURIComponent(t.backendId)}`,
      );
      return r.ok ? await r.text() : null;
    }
    return null;
  }

  function loadTemplate(t: LibTemplate) {
    onLoad(t.modes, t.name, () => resolveSvg(t));
  }

  async function copyTemplate(t: LibTemplate) {
    const svg = await resolveSvg(t);
    if (svg == null) return;
    setClipboard({ kind: "template", name: t.name, modes: t.modes, svg });
  }

  async function copyFolder(path: string) {
    const relFolders = allFolders
      .filter((f) => f.startsWith(`${path}/`))
      .map((f) => f.slice(path.length + 1));
    const subPaths = [path, ...allFolders.filter((f) => f.startsWith(`${path}/`))];
    const templates: {
      folder: string;
      name: string;
      modes: string[];
      svg: string;
    }[] = [];
    for (const sp of subPaths) {
      for (const t of templatesIn(sp)) {
        const svg = await resolveSvg(t);
        if (svg == null) continue;
        templates.push({
          folder: sp === path ? "" : sp.slice(path.length + 1),
          name: t.name,
          modes: t.modes,
          svg,
        });
      }
    }
    setClipboard({
      kind: "folder",
      name: folderName(path),
      folders: relFolders,
      templates,
    });
  }

  function uniqueFolderPath(base: string): string {
    if (!userFolders.includes(base)) return base;
    let i = 2;
    while (userFolders.includes(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  function pasteInto(target: string) {
    if (!clipboard) return;
    if (clipboard.kind === "template") {
      onPaste({
        folders: [],
        templates: [
          { folder: target, name: clipboard.name, modes: clipboard.modes, svg: clipboard.svg },
        ],
      });
      return;
    }
    const root = uniqueFolderPath(target ? `${target}/${clipboard.name}` : clipboard.name);
    onPaste({
      folders: [root, ...clipboard.folders.map((rel) => `${root}/${rel}`)],
      templates: clipboard.templates.map((t) => ({
        folder: t.folder ? `${root}/${t.folder}` : root,
        name: t.name,
        modes: t.modes,
        svg: t.svg,
      })),
    });
    openAncestors(root);
    setOpen((o) => ({ ...o, [root]: true }));
  }

  function onTemplateDragStart(e: DragEvent<HTMLDivElement>, t: LibTemplate) {
    // Read-only (_debug) templates carry only a backendId (load/copy, no move);
    // user templates carry their svg + source id so they can be moved.
    const payload: ImdDragPayload = t.readOnly
      ? { name: t.name, modes: t.modes, backendId: t.backendId }
      : {
          name: t.name,
          modes: t.modes,
          svg: t.svg,
          source: { type: "template", id: t.key },
        };
    e.dataTransfer.setData(IMD_DND_MIME, JSON.stringify(payload));
    // "all" so it stays compatible with the targets' dropEffect (else no-drop cursor).
    e.dataTransfer.effectAllowed = "all";
  }

  function onFolderDragStart(e: DragEvent<HTMLDivElement>, path: string) {
    e.stopPropagation();
    const payload: ImdDragPayload = {
      name: folderName(path),
      modes: [],
      source: { type: "folder", path },
    };
    e.dataTransfer.setData(IMD_DND_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "all";
  }

  function onFolderDrop(e: DragEvent<HTMLElement>, folder: string) {
    e.preventDefault();
    e.stopPropagation();
    if (folder === "_debug") return; // read-only
    const raw = e.dataTransfer.getData(IMD_DND_MIME);
    if (!raw) return;
    let p: ImdDragPayload;
    try {
      p = JSON.parse(raw) as ImdDragPayload;
    } catch {
      return;
    }
    if (p.source?.type === "folder") onMoveFolder(p.source.path, folder);
    else if (p.source?.type === "template") onMoveTemplate(p.source.id, folder);
    else if (p.svg) onSaveToFolder(folder, p); // workspace file -> save new
  }

  function confirmDeleteFolder(path: string) {
    const hasContent =
      childFolders(path).length > 0 || templatesIn(path).length > 0;
    if (
      hasContent &&
      !window.confirm(
        `Delete "${folderName(path)}" and everything inside it? This can't be undone.`,
      )
    ) {
      return;
    }
    onDeleteFolder(path);
  }

  function allowDrop(e: DragEvent<HTMLElement>, folder: string) {
    if (folder === "_debug") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function startRename(kind: "folder" | "template", key: string, current: string) {
    setRenaming({ kind, key });
    setRenameValue(current);
  }

  function commitRename() {
    if (renaming) {
      const value = renameValue.trim() || (renaming.kind === "folder" ? "folder" : "template");
      if (renaming.kind === "folder") onRenameFolder(renaming.key, value);
      else onRenameTemplate(renaming.key, value);
    }
    setRenaming(null);
  }

  function openMenu(e: MouseEvent, m: Omit<Menu, "x" | "y">) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, ...m });
  }

  function menuItems(m: Menu): { label: string; action: () => void }[] {
    const items: { label: string; action: () => void }[] = [];

    if (m.kind === "root") {
      items.push({ label: "New folder", action: () => onNewFolder(null) });
      if (clipboard) items.push({ label: "Paste", action: () => pasteInto("") });
      return items;
    }

    if (m.kind === "folder") {
      const path = m.key!;
      if (path === "_debug") {
        return [
          { label: "New folder", action: () => onNewFolder(null) },
          { label: "Copy", action: () => void copyFolder(path) },
        ];
      }
      items.push({
        label: "New subfolder",
        action: () => {
          openAncestors(path);
          setOpen((o) => ({ ...o, [path]: true }));
          onNewFolder(path);
        },
      });
      items.push({ label: "Rename", action: () => startRename("folder", path, folderName(path)) });
      items.push({ label: "Copy", action: () => void copyFolder(path) });
      if (clipboard) items.push({ label: "Paste", action: () => pasteInto(path) });
      items.push({ label: "Delete", action: () => confirmDeleteFolder(path) });
      return items;
    }

    const t = findTemplate(m.key!);
    items.push({ label: "Load file", action: () => t && loadTemplate(t) });
    if (t) items.push({ label: "Copy", action: () => void copyTemplate(t) });
    if (t && !t.readOnly) {
      items.push({ label: "Rename", action: () => startRename("template", t.key, t.name) });
      items.push({ label: "Delete", action: () => onDeleteTemplate(t.key) });
    }
    return items;
  }

  function renderTemplate(t: LibTemplate, depth: number) {
    const sel = selected?.type === "template" && selected.key === t.key;
    const isRenaming = renaming?.kind === "template" && renaming.key === t.key;
    return (
      <div key={t.key} style={{ paddingLeft: depth * 12 + 4 }}>
        <div
          data-cy="template"
          draggable={!isRenaming}
          onDragStart={(e) => onTemplateDragStart(e, t)}
          onClick={(e) => {
            e.stopPropagation();
            setSelected({ type: "template", key: t.key });
          }}
          onDoubleClick={() => loadTemplate(t)}
          onContextMenu={(e) => {
            setSelected({ type: "template", key: t.key });
            openMenu(e, { kind: "template", key: t.key });
          }}
          className={`flex cursor-grab items-center justify-between gap-1 rounded px-1 py-1 hover:bg-surface-container-high ${
            sel ? "bg-surface-container-high" : ""
          }`}
        >
          {isRenaming ? (
            <input
              autoFocus
              data-cy="rename-input"
              onFocus={(e) => e.currentTarget.select()}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(null);
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full rounded border border-outline bg-surface-container-lowest px-1 text-xs text-on-surface"
            />
          ) : (
            <>
              <span className="truncate text-on-surface">📄 {t.name}</span>
              <span className="flex shrink-0 gap-1">
                {t.modes.map((m) => (
                  <span
                    key={m}
                    className={`rounded px-1 text-[10px] ${
                      m === currentMode
                        ? "bg-success/10 text-success"
                        : "bg-surface-container-high text-on-surface-variant"
                    }`}
                  >
                    {MODE_LABEL[m] ?? m}
                  </span>
                ))}
              </span>
            </>
          )}
        </div>
      </div>
    );
  }

  function renderFolder(path: string, depth: number) {
    const isOpen = open[path] ?? false;
    const sel = selected?.type === "folder" && selected.key === path;
    const isRenaming = renaming?.kind === "folder" && renaming.key === path;
    const subFolders = childFolders(path);
    const subTemplates = templatesIn(path);
    const hasContent = subFolders.length > 0 || subTemplates.length > 0;
    return (
      <div key={path}>
        <div
          data-cy="folder"
          draggable={path !== "_debug" && !isRenaming}
          onDragStart={(e) => onFolderDragStart(e, path)}
          onClick={(e) => {
            e.stopPropagation();
            setSelected({ type: "folder", key: path });
            setOpen((o) => ({ ...o, [path]: !isOpen }));
          }}
          onContextMenu={(e) => {
            setSelected({ type: "folder", key: path });
            openMenu(e, { kind: "folder", key: path });
          }}
          onDrop={(e) => onFolderDrop(e, path)}
          onDragOver={(e) => allowDrop(e, path)}
          style={{ paddingLeft: depth * 12 + 4 }}
          className={`flex cursor-pointer items-center gap-1 rounded px-1 py-1 hover:bg-surface-container-high ${
            sel ? "bg-surface-container-high" : ""
          }`}
        >
          <span className="w-3 text-on-surface-variant">
            {hasContent ? (isOpen ? "▾" : "▸") : ""}
          </span>
          {isRenaming ? (
            <input
              autoFocus
              data-cy="rename-input"
              onFocus={(e) => e.currentTarget.select()}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(null);
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full rounded border border-outline bg-surface-container-lowest px-1 text-xs text-on-surface"
            />
          ) : (
            <span className="truncate text-on-surface">📁 {folderName(path)}</span>
          )}
        </div>
        {isOpen && hasContent && (
          <div>
            {subFolders.map((f) => renderFolder(f, depth + 1))}
            {subTemplates.map((t) => renderTemplate(t, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-outline-variant pr-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
          Library
        </h3>
        <button
          type="button"
          data-cy="new-folder-btn"
          onClick={() =>
            onNewFolder(
              selected?.type === "folder" && selected.key !== "_debug"
                ? selected.key
                : null,
            )
          }
          title="New folder (inside the selected folder, else at root)"
          className="rounded border border-outline px-2 py-0.5 text-xs text-on-surface hover:border-primary"
        >
          ＋ Folder
        </button>
      </div>

      {/* Tree. Clicking empty space deselects; right-click here = new root folder. */}
      <div
        className="mt-3 flex-1 space-y-0.5 overflow-y-auto text-sm"
        onClick={() => setSelected(null)}
        onContextMenu={(e) => openMenu(e, { kind: "root" })}
        onDrop={(e) => onFolderDrop(e, "")}
        onDragOver={(e) => allowDrop(e, "")}
      >
        {error && <p className="text-xs text-error">{error}</p>}
        {childFolders(null).map((f) => renderFolder(f, 0))}
        {templatesIn("").map((t) => renderTemplate(t, 0))}
      </div>

      <p className="mt-3 border-t border-outline-variant pt-2 text-[10px] text-on-surface-variant">
        {loggedIn
          ? "Your folders and templates are saved to your account."
          : "Log in to save your own folders and templates."}
      </p>

      {menu && (
        <div
          data-cy="context-menu"
          className="fixed z-[60] min-w-[9rem] rounded-md border border-outline bg-surface-container-lowest py-1 text-sm shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menuItems(menu).map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => {
                it.action();
                setMenu(null);
              }}
              className="block w-full px-3 py-1.5 text-left text-on-surface hover:bg-surface-container-high"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
