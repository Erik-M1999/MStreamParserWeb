"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { BACKEND_URL } from "@/shared/config";
import { focusSvgToContent, getSvgDimensions } from "@/features/imd/lib/focusSvg";
import { downloadBlob, svgStringToBlob, svgToPngBlob } from "@/features/imd/lib/download";
import {
  measureText,
  applyTextOffset,
  type TextMetrics,
} from "@/features/imd/lib/textOffset";
import { IMD_DND_MIME, type ImdDragPayload } from "@/features/imd/lib/dragPayload";
import SvgTagEditor from "@/features/imd/SvgTagEditor";

interface NowPlaying {
  playing: boolean;
  /** false when a non-song (podcast episode/ad) is playing. */
  supported?: boolean;
  /** "track" | "episode" | "ad" | "unknown" */
  type?: string;
  /** true = playing right now; false = a most-recently-played fallback (Last.fm). */
  live?: boolean;
  artist?: string;
  title?: string;
  album?: string;
}

/** A stable key for a playing song, or null if not a playable song. */
function songKey(np: NowPlaying | null): string | null {
  if (!np?.playing || np.supported === false || !np.artist || !np.title) {
    return null;
  }
  return `${np.artist} — ${np.title}`;
}

function unsupportedLabel(type?: string): string {
  if (type === "episode") return "a podcast episode";
  if (type === "ad") return "an ad";
  return "something that isn't a song";
}

// The full rendered document (NOT the cropped preview) — used for downloads.
interface Rendered {
  fullSvg: string;
  width: number;
  height: number;
}

type PngScale = "original" | "1k" | "2k" | "4k" | "8k" | "custom";

const PRESET_LONGEST: Record<string, number> = {
  "1k": 1024,
  "2k": 2048,
  "4k": 4096,
  "8k": 8192,
};

const MAX_PX = 16384; // canvas safety cap

function clampInt(value: string | number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_PX, Math.max(1, n));
}

function sanitizeFileBase(s: string): string {
  return s.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "immersive-display";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clampPct(value: string | number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.1;
  return Math.min(500, Math.max(0.1, round1(n)));
}

type Provider = "spotify" | "lastfm";

export default function CurrentSongMode({
  spotifyConnected,
  lastfmConnected,
  loggedIn,
  pendingTemplate,
}: {
  spotifyConnected: boolean;
  lastfmConnected: boolean;
  loggedIn: boolean;
  pendingTemplate?: {
    token: number;
    name: string;
    svg: string;
    mode: string;
  } | null;
}) {
  // Current Song works with either provider; Spotify is the default. Queue and
  // Playlist modes stay Spotify-only, so they don't get this toggle.
  const [provider, setProvider] = useState<Provider>("spotify");
  const connected = provider === "spotify" ? spotifyConnected : lastfmConnected;
  const [refreshing, setRefreshing] = useState(false);
  const [templateSvg, setTemplateSvg] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loadedOk, setLoadedOk] = useState(false); // last render succeeded
  const [editorOpen, setEditorOpen] = useState(false); // SVG tag editor panel
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  // The song the current preview was rendered for (to detect track changes).
  const [renderedKey, setRenderedKey] = useState<string | null>(null);

  // Long-text handling. rawFilled = the backend's output; the displayed/
  // exported SVG is derived from it + these settings (see the effect below).
  // Width % + fade % are SHARED by title & artist; offsets are independent.
  const [rawFilled, setRawFilled] = useState<string | null>(null);
  const [textMetrics, setTextMetrics] = useState<TextMetrics | null>(null);
  const [longText, setLongText] = useState(false);
  const [widthPct, setWidthPct] = useState(0); // window width, % of viewBox width
  const [fadePct, setFadePct] = useState(20); // left-fade width, % of the window
  const [titleOffsetRoot, setTitleOffsetRoot] = useState(0);
  const [artistOffsetRoot, setArtistOffsetRoot] = useState(0);

  // PNG export controls.
  const [pngScale, setPngScale] = useState<PngScale>("original");
  const [customW, setCustomW] = useState(1000);
  const [customH, setCustomH] = useState(1000);
  const [exporting, setExporting] = useState(false);

  const previewUrlRef = useRef<string | null>(null);

  function setPreview(url: string | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreviewUrl(url);
  }

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  // Default the custom resolution to the full document's size.
  useEffect(() => {
    if (rendered) {
      setCustomW(Math.round(rendered.width));
      setCustomH(Math.round(rendered.height));
    }
  }, [rendered]);

  // Derive the displayed + exported SVG from the raw fill + long-text settings.
  // Re-runs when any setting changes so preview and downloads stay in sync.
  useEffect(() => {
    if (!rawFilled) {
      setRendered(null);
      setPreview(null);
      return;
    }
    const vb = textMetrics?.viewBoxWidth ?? 0;
    let active = rawFilled;
    if (longText && vb > 0 && widthPct > 0) {
      const thresholdRoot = (widthPct / 100) * vb;
      const fadeRatio = fadePct / 100;
      active = applyTextOffset(rawFilled, {
        title: { thresholdRoot, offsetRoot: titleOffsetRoot, fadeRatio },
        artist: { thresholdRoot, offsetRoot: artistOffsetRoot, fadeRatio },
      });
    }
    const dims = getSvgDimensions(active);
    setRendered({ fullSvg: active, width: dims.width, height: dims.height });
    setPreview(URL.createObjectURL(svgStringToBlob(focusSvgToContent(active))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawFilled, longText, widthPct, fadePct, titleOffsetRoot, artistOffsetRoot]);

  async function fetchNowPlaying(): Promise<NowPlaying | null> {
    try {
      const res = await fetch(`${BACKEND_URL}/api/${provider}/now-playing`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = (await res.json()) as NowPlaying;
        setNowPlaying(data);
        return data;
      }
    } catch {
      /* non-critical */
    }
    return null;
  }

  // Manual re-check of the current/most-recent track. The live stream only polls
  // every ~12s and Last.fm scrobbles lag, so this lets the user pull the latest
  // before rendering (the render itself always re-fetches server-side).
  async function refreshNowPlaying() {
    setRefreshing(true);
    try {
      await fetchNowPlaying();
    } finally {
      setRefreshing(false);
    }
  }

  // Live "Now playing" via SSE: the backend pushes the track whenever it changes,
  // so the line follows playback without polling. EventSource auto-reconnects on
  // drop. The user still re-renders the image manually (see the songChanged hint).
  useEffect(() => {
    // Switching provider clears the stale track until the new stream reports.
    setNowPlaying(null);
    if (!connected) return;
    const es = new EventSource(
      `${BACKEND_URL}/api/${provider}/now-playing/stream`,
      { withCredentials: true },
    );
    es.onmessage = (e) => {
      try {
        setNowPlaying(JSON.parse(e.data) as NowPlaying);
      } catch {
        /* ignore a malformed event */
      }
    };
    // EventSource reconnects on its own; no onerror handling needed.
    return () => es.close();
  }, [connected, provider]);

  async function render(svg: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/immersive/render`, {
        method: "POST",
        headers: { "Content-Type": "image/svg+xml" },
        credentials: "include",
        body: svg,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Render failed (${res.status}).`);
        setRawFilled(null);
        setTextMetrics(null);
        setLoadedOk(false);
        return;
      }
      const filled = await res.text();
      setLoadedOk(true);
      setRawFilled(filled); // the effect derives the preview + export SVG
      // Measure title + artist; shared defaults from whichever field exists
      // (title and artist share the same horizontal geometry in these templates).
      const metrics = measureText(filled);
      setTextMetrics(metrics);
      const ref = metrics.title.present ? metrics.title : metrics.artist;
      const vb = metrics.viewBoxWidth || 1;
      setWidthPct(ref.present ? round1((ref.suggestedThresholdRoot / vb) * 100) : 0);
      setFadePct(round1(ref.fadeRatio * 100));
      setTitleOffsetRoot(0);
      setArtistOffsetRoot(0);
      // Remember which song this preview reflects, to flag later changes.
      setRenderedKey(songKey(await fetchNowPlaying()));
    } catch {
      setError("Could not reach the backend. Is it running on port 3000?");
      setLoadedOk(false);
    } finally {
      setLoading(false);
    }
  }

  // Load a template chosen from the library (only if it targets this mode).
  useEffect(() => {
    if (!pendingTemplate || pendingTemplate.mode !== "current-song") return;
    setTemplateSvg(pendingTemplate.svg);
    setTemplateName(pendingTemplate.name);
    void render(pendingTemplate.svg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTemplate?.token]);

  async function handleFile(file: File) {
    const isSvg =
      file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
    if (!isSvg) {
      setError("Please provide an .svg file.");
      return;
    }
    const text = await file.text();
    setTemplateSvg(text);
    setTemplateName(file.name);
    await render(text);
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  async function handlePayload(p: ImdDragPayload) {
    let svg = p.svg ?? null;
    if (!svg && p.backendId) {
      try {
        const r = await fetch(
          `${BACKEND_URL}/api/sample-templates/${encodeURIComponent(p.backendId)}`,
        );
        if (r.ok) svg = await r.text();
      } catch {
        /* ignore */
      }
    }
    if (!svg) return;
    setTemplateSvg(svg);
    setTemplateName(p.name);
    await render(svg);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const payload = e.dataTransfer.getData(IMD_DND_MIME);
    if (payload) {
      try {
        void handlePayload(JSON.parse(payload) as ImdDragPayload);
      } catch {
        /* ignore malformed payload */
      }
      return;
    }
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  // Drag the loaded file OUT to the Library to save it into a folder.
  function onLoadedDragStart(e: DragEvent<HTMLDivElement>) {
    if (!templateSvg) return;
    const payload: ImdDragPayload = {
      name: templateName ?? "template",
      modes: ["current-song"],
      svg: templateSvg,
    };
    e.dataTransfer.setData(IMD_DND_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "all";
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dragging) setDragging(true);
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
  }

  function handleApplyTags(newSvg: string) {
    setTemplateSvg(newSvg);
    setEditorOpen(false);
    void render(newSvg);
  }

  function fileBase(): string {
    if (nowPlaying?.playing && nowPlaying.artist && nowPlaying.title) {
      return sanitizeFileBase(`${nowPlaying.artist} - ${nowPlaying.title}`);
    }
    return "immersive-display";
  }

  // Target PNG size from the FULL document's aspect ratio.
  function targetSize(): { w: number; h: number } {
    if (!rendered) return { w: 0, h: 0 };
    const aw = rendered.width;
    const ah = rendered.height;
    if (pngScale === "original") return { w: Math.round(aw), h: Math.round(ah) };
    if (pngScale === "custom") return { w: customW, h: customH };
    const longest = PRESET_LONGEST[pngScale];
    return aw >= ah
      ? { w: longest, h: Math.max(1, Math.round(longest * (ah / aw))) }
      : { h: longest, w: Math.max(1, Math.round(longest * (aw / ah))) };
  }

  function onCustomWidth(v: string) {
    const w = clampInt(v);
    setCustomW(w);
    if (rendered) setCustomH(clampInt((w * rendered.height) / rendered.width));
  }

  function onCustomHeight(v: string) {
    const h = clampInt(v);
    setCustomH(h);
    if (rendered) setCustomW(clampInt((h * rendered.width) / rendered.height));
  }

  function thresholdRoot(): number {
    return ((textMetrics?.viewBoxWidth ?? 0) * widthPct) / 100;
  }

  function randomizeSlot(which: "title" | "artist") {
    if (!textMetrics) return;
    const widthRoot = textMetrics[which].widthRoot;
    const overflow = Math.max(0, widthRoot - thresholdRoot());
    const value = Math.random() * overflow;
    if (which === "title") setTitleOffsetRoot(value);
    else setArtistOffsetRoot(value);
  }

  function downloadSvg() {
    if (!rendered) return;
    downloadBlob(svgStringToBlob(rendered.fullSvg), `${fileBase()}.svg`);
  }

  async function downloadPng() {
    if (!rendered) return;
    const { w, h } = targetSize();
    setExporting(true);
    setError(null);
    try {
      const blob = await svgToPngBlob(rendered.fullSvg, w, h);
      downloadBlob(blob, `${fileBase()}_${w}x${h}.png`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PNG export failed.");
    } finally {
      setExporting(false);
    }
  }

  // The source toggle (shown whether or not the chosen provider is connected, so
  // the user can always switch). Spotify default; Last.fm is the alternative.
  const providerSelector = (
    <div className="flex items-center gap-2">
      <span className="type-label-sm text-on-surface-variant">API</span>
      <div className="flex border border-outline-variant">
        {(["spotify", "lastfm"] as const).map((p) => {
          const isSel = provider === p;
          const isConn = p === "spotify" ? spotifyConnected : lastfmConnected;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setProvider(p)}
              className={`flex items-center gap-1.5 px-3 py-1.5 type-label-bold uppercase transition-colors ${
                isSel
                  ? "bg-primary text-on-primary"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {p === "spotify" ? "Spotify" : "Last.fm"}
              <span
                aria-hidden
                title={isConn ? "Connected" : "Not connected"}
                className={`h-1.5 w-1.5 rounded-full ${
                  isConn ? "bg-success" : "bg-surface-dim"
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );

  if (!connected) {
    return (
      <div className="space-y-4">
        {providerSelector}
        <div className="border border-outline-variant bg-surface-container-low p-6">
          {!loggedIn ? (
            <>
              <p className="text-sm text-on-surface">
                Log in to connect an API and use this tool.
              </p>
              <a
                href="/login"
                className="mt-4 inline-block bg-primary px-4 py-2 type-label-bold uppercase text-on-primary transition-colors hover:bg-primary-container"
              >
                Log in
              </a>
            </>
          ) : provider === "spotify" ? (
            <>
              <p className="text-sm text-on-surface">
                Connect your Spotify account to use this source.
              </p>
              <a
                href={`${BACKEND_URL}/api/auth/spotify/login`}
                className="mt-4 inline-block bg-primary px-4 py-2 type-label-bold uppercase text-on-primary transition-colors hover:bg-primary-container"
              >
                Connect Spotify
              </a>
            </>
          ) : (
            <p className="text-sm text-on-surface">
              Connect your Last.fm account from the left panel to use it here.
            </p>
          )}
        </div>
      </div>
    );
  }

  const liveKey = songKey(nowPlaying);
  const songChanged = Boolean(
    previewUrl && renderedKey && liveKey && liveKey !== renderedKey,
  );
  const tRoot = thresholdRoot();
  const titleOverflow = Boolean(
    textMetrics?.title.present && textMetrics.title.widthRoot > tRoot,
  );
  const artistOverflow = Boolean(
    textMetrics?.artist.present && textMetrics.artist.widthRoot > tRoot,
  );
  const hasTextField = Boolean(
    textMetrics?.title.present || textMetrics?.artist.present,
  );
  // Active only while enabled AND something actually overflows, so the controls
  // collapse (and the box reads unchecked) when a re-render fits the boundary.
  const longTextActive = longText && (titleOverflow || artistOverflow);

  const providerLabel = provider === "spotify" ? "Spotify" : "Last.fm";
  const isLastfm = provider === "lastfm";
  const emptyMsg = isLastfm
    ? "No recent scrobbles on Last.fm yet."
    : `Nothing is playing on ${providerLabel} right now.`;
  // Label + status follow the payload's live flag (live track vs recent fallback).
  const isLive = nowPlaying?.live !== false;
  const nowLabel = isLive ? "Now playing:" : "Most recent:";

  return (
    <div className="space-y-6">
      {providerSelector}

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm text-on-surface-variant">
          {!nowPlaying?.playing ? (
            emptyMsg
          ) : nowPlaying.supported === false ? (
            <span className="text-amber-600">
              {providerLabel} is playing {unsupportedLabel(nowPlaying.type)} —
              only songs are supported.
            </span>
          ) : (
            <>
              <span
                className={`shrink-0 border px-1.5 py-0.5 type-label-sm ${
                  isLive
                    ? "border-success text-success"
                    : "border-outline-variant text-on-surface-variant"
                }`}
              >
                {isLive ? "Live" : "Recent"}
              </span>
              <span className="truncate">
                {nowLabel}{" "}
                <span className="text-on-surface">
                  {nowPlaying.artist} — {nowPlaying.title}
                </span>
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={refreshNowPlaying}
          disabled={refreshing}
          title="Re-check the current track"
          className="shrink-0 border border-outline-variant px-3 py-1 type-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshing ? "Checking…" : "Refresh"}
        </button>
      </div>

      {/* Drag-and-drop zone (also click-to-browse). Once a file is loaded it
          shows a draggable file icon you can drop into the Library to save. */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragging
            ? "border-success bg-success/5"
            : "border-outline bg-surface-container-low"
        }`}
      >
        {templateSvg ? (
          <div className="flex flex-col items-center gap-2">
            <div
              draggable
              onDragStart={onLoadedDragStart}
              title="Drag into the Library to save"
              className="cursor-grab select-none text-5xl leading-none"
            >
              🗎
            </div>
            <p
              className={`text-sm ${loadedOk ? "text-success" : "text-amber-600"}`}
            >
              Loaded: {templateName}
            </p>
            <label className="cursor-pointer text-xs text-on-surface-variant underline hover:text-on-surface">
              Drop or browse to replace
              <input
                type="file"
                accept=".svg,image/svg+xml"
                className="hidden"
                onChange={onFileChange}
              />
            </label>
          </div>
        ) : (
          <>
            <p className="text-sm text-on-surface">
              Drag &amp; drop an SVG template here
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">or</p>
            <label className="mt-2 inline-block cursor-pointer rounded-md border border-outline px-4 py-2 text-sm hover:border-primary">
              Browse files
              <input
                type="file"
                accept=".svg,image/svg+xml"
                className="hidden"
                onChange={onFileChange}
              />
            </label>
          </>
        )}
      </div>

      {templateSvg && (
        <div>
          <button
            type="button"
            onClick={() => setEditorOpen((o) => !o)}
            className="rounded-md border border-outline px-4 py-2 text-sm hover:border-primary"
          >
            {editorOpen ? "Close tag editor" : "Edit tags"}
          </button>
          {editorOpen && (
            <div className="mt-2">
              <SvgTagEditor
                svg={templateSvg}
                mode="current-song"
                onApply={handleApplyTags}
                onClose={() => setEditorOpen(false)}
              />
            </div>
          )}
        </div>
      )}

      {templateSvg && (
        <div className="space-y-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => render(templateSvg)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading
              ? "Rendering…"
              : isLive
                ? "Re-render with current song"
                : "Re-render with recent song"}
          </button>
          {songChanged && (
            <p className="text-xs text-amber-600">
              The song changed — re-render to update the preview.
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-error bg-error-container px-4 py-3 text-sm text-on-error-container">
          {error}
        </div>
      )}

      {previewUrl && rendered && (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low p-4">
          <p className="mb-3 text-xs uppercase tracking-wider text-on-surface-variant">
            Preview (cropped to artwork)
          </p>
          {/* Rendered as <img> (not inline) so an uploaded SVG can't run scripts. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Rendered template preview"
            className="mx-auto max-h-[24rem] w-auto"
          />

          {/* Long-text handling (title + artist share width/fade; randomize is per-field) */}
          {hasTextField && (
            <div className="mt-4 space-y-3 border-t border-outline-variant pt-4">
              <label
                className={`flex items-center gap-2 text-sm ${
                  titleOverflow || artistOverflow
                    ? "text-on-surface"
                    : "cursor-not-allowed text-on-surface-variant"
                }`}
              >
                <input
                  type="checkbox"
                  checked={longTextActive}
                  disabled={!titleOverflow && !artistOverflow}
                  onChange={(e) => setLongText(e.target.checked)}
                />
                Handle long text (clip to width + left fade)
              </label>

              {longTextActive && (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col text-xs text-on-surface-variant">
                      Left fade (%)
                      <input
                        type="number"
                        min={0.1}
                        step={0.1}
                        value={fadePct}
                        onChange={(e) => setFadePct(clampPct(e.target.value))}
                        className="mt-1 w-24 rounded-md border border-outline bg-surface-container-lowest px-2 py-1.5 text-sm text-on-surface"
                      />
                    </label>
                    <label className="flex flex-col text-xs text-on-surface-variant">
                      Right fade (%)
                      <input
                        type="number"
                        min={0.1}
                        step={0.1}
                        value={widthPct}
                        onChange={(e) => setWidthPct(clampPct(e.target.value))}
                        className="mt-1 w-24 rounded-md border border-outline bg-surface-container-lowest px-2 py-1.5 text-sm text-on-surface"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {textMetrics?.title.present && (
                      <button
                        type="button"
                        onClick={() => randomizeSlot("title")}
                        disabled={!titleOverflow}
                        className="rounded-md border border-outline px-4 py-2 text-sm hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Randomize title
                      </button>
                    )}
                    {textMetrics?.artist.present && (
                      <button
                        type="button"
                        onClick={() => randomizeSlot("artist")}
                        disabled={!artistOverflow}
                        className="rounded-md border border-outline px-4 py-2 text-sm hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Randomize artist
                      </button>
                    )}
                    <span className="text-xs text-on-surface-variant">
                      {titleOverflow || artistOverflow
                        ? "Overflowing fields can be panned."
                        : "Text fits — no offset needed."}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Downloads — always export the FULL document, not the crop. */}
          <div className="mt-4 space-y-3 border-t border-outline-variant pt-4">
            <button
              type="button"
              onClick={downloadSvg}
              className="rounded-md border border-outline px-4 py-2 text-sm hover:border-primary"
            >
              Download SVG
            </button>

            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col text-xs text-on-surface-variant">
                PNG resolution
                <select
                  value={pngScale}
                  onChange={(e) => setPngScale(e.target.value as PngScale)}
                  className="mt-1 rounded-md border border-outline bg-surface-container-lowest px-2 py-1.5 text-sm text-on-surface"
                >
                  <option value="original">
                    Original ({Math.round(rendered.width)}×{Math.round(rendered.height)})
                  </option>
                  <option value="1k">1K (longest 1024)</option>
                  <option value="2k">2K (longest 2048)</option>
                  <option value="4k">4K (longest 4096)</option>
                  <option value="8k">8K (longest 8192)</option>
                  <option value="custom">Custom…</option>
                </select>
              </label>

              {pngScale === "custom" && (
                <div className="flex items-end gap-1">
                  <label className="flex flex-col text-xs text-on-surface-variant">
                    Width
                    <input
                      type="number"
                      min={1}
                      max={MAX_PX}
                      value={customW}
                      onChange={(e) => onCustomWidth(e.target.value)}
                      className="mt-1 w-24 rounded-md border border-outline bg-surface-container-lowest px-2 py-1.5 text-sm text-on-surface"
                    />
                  </label>
                  <span className="pb-2 text-on-surface-variant">×</span>
                  <label className="flex flex-col text-xs text-on-surface-variant">
                    Height
                    <input
                      type="number"
                      min={1}
                      max={MAX_PX}
                      value={customH}
                      onChange={(e) => onCustomHeight(e.target.value)}
                      className="mt-1 w-24 rounded-md border border-outline bg-surface-container-lowest px-2 py-1.5 text-sm text-on-surface"
                    />
                  </label>
                </div>
              )}

              <button
                type="button"
                onClick={downloadPng}
                disabled={exporting}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {exporting ? "Exporting…" : "Download PNG"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
