"use client";

import { useCallback, useEffect, useState } from "react";
import { BACKEND_URL } from "@/shared/config";
import {
  listPlaylists,
  exportPlaylist,
  type PlaylistSummary,
  type PlaylistExport,
} from "./playlist.api";

// Accepts an open.spotify.com link, a spotify:playlist: URI, or a bare id.
function extractPlaylistId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/playlist[/:]([A-Za-z0-9]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9]{16,}$/.test(s)) return s; // looks like a bare id
  return null;
}

// One line per track: "ID: Artist - Song Name" (ID = place in playlist order).
function toTxt(p: PlaylistExport): string {
  return p.tracks.map((t) => `${t.position}: ${t.artist} - ${t.title}`).join("\r\n");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "playlist";
}

const errMsg = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong.";

export default function PlaylistExtractorTool({
  connected,
  loggedIn,
}: {
  connected: boolean;
  loggedIn: boolean;
}) {
  const [url, setUrl] = useState("");
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [loaded, setLoaded] = useState<PlaylistExport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMine = useCallback(async () => {
    setListLoading(true);
    setError(null);
    try {
      setPlaylists(await listPlaylists());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setListLoading(false);
    }
  }, []);

  // Pull the user's playlists once, since the tool requires a connection.
  useEffect(() => {
    if (connected) void loadMine();
  }, [connected, loadMine]);

  async function loadById(id: string) {
    setBusy(true);
    setError(null);
    try {
      setLoaded(await exportPlaylist(id));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function onLoadUrl() {
    const id = extractPlaylistId(url);
    if (!id) {
      setError("Paste a valid Spotify playlist link.");
      return;
    }
    void loadById(id);
  }

  function download() {
    if (!loaded) return;
    const blob = new Blob([toTxt(loaded)], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${sanitizeFilename(loaded.name)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  if (!connected) {
    return (
      <div className="border border-outline-variant bg-surface-container-low p-6">
        {loggedIn ? (
          <>
            <p className="text-sm text-on-surface">
              Connect your Spotify account to use this tool.
            </p>
            <a
              href={`${BACKEND_URL}/api/auth/spotify/login`}
              className="mt-4 inline-block bg-primary px-4 py-2 type-label-bold uppercase text-on-primary transition-colors hover:bg-primary-container"
            >
              Connect Spotify
            </a>
          </>
        ) : (
          <>
            <p className="text-sm text-on-surface">
              Log in to connect Spotify and use this tool.
            </p>
            <a
              href="/login"
              className="mt-4 inline-block bg-primary px-4 py-2 type-label-bold uppercase text-on-primary transition-colors hover:bg-primary-container"
            >
              Log in
            </a>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="border border-error bg-error-container px-3 py-2 text-sm text-on-error-container">
          {error}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {/* Option A: paste a public playlist link */}
        <div>
          <h3 className="type-label-sm text-on-surface-variant">Playlist link</h3>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onLoadUrl()}
              placeholder="https://open.spotify.com/playlist/…"
              className="min-w-0 flex-1 border border-outline bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={onLoadUrl}
              disabled={busy || !url.trim()}
              className="shrink-0 bg-primary px-4 py-2 type-label-bold uppercase text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
            >
              Load
            </button>
          </div>
        </div>

        {/* Option B: pick from the user's saved playlists */}
        <div>
          <div className="flex items-center justify-between">
            <h3 className="type-label-sm text-on-surface-variant">Your playlists</h3>
            <button
              type="button"
              onClick={loadMine}
              className="shrink-0 bg-primary px-4 py-2 type-label-bold uppercase text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
          {listLoading ? (
            <p className="mt-2 text-sm text-on-surface-variant">Loading…</p>
          ) : playlists.length === 0 ? (
            <p className="mt-2 text-sm text-on-surface-variant">No playlists found.</p>
          ) : (
            <ul className="mt-2 max-h-56 divide-y divide-outline-variant overflow-y-auto border border-outline-variant">
              {playlists.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => loadById(p.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-container-high"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-on-surface">
                      {p.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {busy && (
        <p className="text-sm text-on-surface-variant">Loading playlist…</p>
      )}

      {/* Loaded playlist: preview + download */}
      {loaded && !busy && (
        <div className="border border-outline-variant bg-surface-container-low p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate type-headline-md text-on-surface">{loaded.name}</p>
              <p className="type-label-sm text-on-surface-variant">
                {loaded.tracks.length} tracks
                {loaded.owner ? ` · ${loaded.owner}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={download}
              disabled={loaded.tracks.length === 0}
              className="shrink-0 bg-primary px-4 py-2 type-label-bold uppercase text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download .txt
            </button>
          </div>
          {loaded.tracks.length > 0 && (
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words border border-outline-variant bg-surface-container-lowest p-3 text-xs leading-relaxed text-on-surface-variant">
              {toTxt(loaded)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
