"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from "react";
import { BACKEND_URL } from "@/shared/config";
import {
  listPlaylistsPage,
  exportPlaylist,
  type PlaylistSummary,
  type PlaylistExport,
} from "./playlist.api";

const PAGE_SIZE = 50; // playlists fetched per request
const ROW_CHUNK = 30; // rows revealed per lazy-render step

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
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(ROW_CHUNK);
  const [loaded, setLoaded] = useState<PlaylistExport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a stale in-flight load overwriting a newer one (Refresh).
  const runRef = useRef(0);

  const loadMine = useCallback(async () => {
    const run = ++runRef.current;
    setListLoading(true);
    setError(null);
    setPlaylists([]);
    setRecentIds([]);
    try {
      // First page paints immediately…
      const first = await listPlaylistsPage(0, PAGE_SIZE);
      if (runRef.current !== run) return;
      setRecentIds(first.recentIds);
      setPlaylists(first.playlists);
      setListLoading(false);

      // …the rest streams in behind it, so big libraries stay responsive.
      let offset = first.playlists.length;
      let hasMore = first.hasMore;
      setLoadingMore(hasMore);
      while (hasMore) {
        const page = await listPlaylistsPage(offset, PAGE_SIZE);
        if (runRef.current !== run) return;
        if (page.playlists.length === 0) break;
        setPlaylists((prev) => [...prev, ...page.playlists]);
        offset += page.playlists.length;
        hasMore = page.hasMore;
      }
      if (runRef.current === run) setLoadingMore(false);
    } catch (e) {
      if (runRef.current !== run) return;
      setError(errMsg(e));
      setListLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Pull the user's playlists once, since the tool requires a connection.
  useEffect(() => {
    if (connected) void loadMine();
  }, [connected, loadMine]);

  // Rank recently-played first; everything else keeps its library order.
  const ordered = useMemo(() => {
    if (recentIds.length === 0) return playlists;
    const rank = new Map(recentIds.map((id, i) => [id, i]));
    return [...playlists].sort(
      (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity),
    );
  }, [playlists, recentIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.owner.toLowerCase().includes(q),
    );
  }, [ordered, query]);

  // Restart the lazy window whenever the visible set changes meaning.
  useEffect(() => setVisible(ROW_CHUNK), [query]);

  function onListScroll(e: UIEvent<HTMLUListElement>) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      setVisible((v) => (v < filtered.length ? v + ROW_CHUNK : v));
    }
  }

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
    <div className="space-y-4">
      {error && (
        <p className="border border-error bg-error-container px-3 py-2 text-sm text-on-error-container">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[24rem_minmax(0,1fr)]">
        {/* Left column: playlist link on top, the user's playlists below. */}
        <div className="flex flex-col gap-5">
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

          <div className="flex min-h-0 flex-col">
            <div className="flex items-center justify-between gap-2">
              <h3 className="type-label-sm text-on-surface-variant">
                Your playlists
                {playlists.length > 0 && (
                  <span className="ml-1 normal-case">({filtered.length})</span>
                )}
              </h3>
              <button
                type="button"
                onClick={loadMine}
                className="shrink-0 bg-primary px-4 py-2 type-label-bold uppercase text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
              >
                Refresh
              </button>
            </div>

            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search playlists…"
              className="mt-2 w-full border border-outline bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
            />

            {listLoading ? (
              <p className="mt-2 text-sm text-on-surface-variant">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="mt-2 text-sm text-on-surface-variant">
                {playlists.length === 0
                  ? "No playlists found."
                  : "No playlists match that search."}
              </p>
            ) : (
              <>
                <ul
                  onScroll={onListScroll}
                  className="mt-2 h-[32rem] divide-y divide-outline-variant overflow-y-auto border border-outline-variant"
                >
                  {filtered.slice(0, visible).map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => loadById(p.id)}
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-container-high ${
                          loaded?.id === p.id ? "bg-surface-container-high" : ""
                        }`}
                      >
                        {p.coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.coverUrl}
                            alt=""
                            loading="lazy"
                            className="h-10 w-10 shrink-0 object-cover"
                          />
                        ) : (
                          <span
                            aria-hidden
                            className="h-10 w-10 shrink-0 bg-surface-container-high"
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm text-on-surface">
                          {p.name}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {loadingMore && (
                  <p className="mt-2 type-label-sm text-on-surface-variant">
                    Loading more…
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right column: the loaded playlist + download. */}
        <div className="min-w-0">
          {busy ? (
            <p className="text-sm text-on-surface-variant">Loading playlist…</p>
          ) : loaded ? (
            <div className="border border-outline-variant bg-surface-container-low p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {loaded.coverUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={loaded.coverUrl}
                      alt=""
                      className="h-14 w-14 shrink-0 object-cover"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="truncate type-headline-md text-on-surface">
                      {loaded.name}
                    </p>
                    <p className="type-label-sm text-on-surface-variant">
                      {loaded.tracks.length} tracks
                      {loaded.owner ? ` · ${loaded.owner}` : ""}
                    </p>
                  </div>
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
                <pre className="mt-3 h-[32rem] overflow-auto whitespace-pre-wrap break-words border border-outline-variant bg-surface-container-lowest p-3 text-xs leading-relaxed text-on-surface-variant">
                  {toTxt(loaded)}
                </pre>
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-[20rem] items-center justify-center border border-dashed border-outline-variant bg-surface-container-low p-6">
              <p className="text-center text-sm text-on-surface-variant">
                Pick a playlist or paste a link to preview
                <br />
                and download it as a .txt file.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
