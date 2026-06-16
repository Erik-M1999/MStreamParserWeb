"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { BACKEND_URL } from "@/config";
import { focusSvgToContent, getSvgDimensions } from "@/lib/imd/focusSvg";
import { downloadBlob, svgStringToBlob, svgToPngBlob } from "@/lib/imd/download";

interface NowPlaying {
  playing: boolean;
  /** false when a non-song (podcast episode/ad) is playing. */
  supported?: boolean;
  /** "track" | "episode" | "ad" | "unknown" */
  type?: string;
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

export default function CurrentSongMode({
  connected,
}: {
  connected: boolean;
}) {
  const [templateSvg, setTemplateSvg] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  // The song the current preview was rendered for (to detect track changes).
  const [renderedKey, setRenderedKey] = useState<string | null>(null);

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

  async function fetchNowPlaying(): Promise<NowPlaying | null> {
    try {
      const res = await fetch(`${BACKEND_URL}/api/spotify/now-playing`);
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

  // Poll so the "Now playing" line stays current and the user can see when the
  // song changes (and re-render to it). Cleared when the modal/component closes.
  useEffect(() => {
    if (!connected) return;
    void fetchNowPlaying();
    const id = setInterval(() => void fetchNowPlaying(), 10000);
    return () => clearInterval(id);
  }, [connected]);

  async function render(svg: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/immersive/render`, {
        method: "POST",
        headers: { "Content-Type": "image/svg+xml" },
        body: svg,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Render failed (${res.status}).`);
        setPreview(null);
        setRendered(null);
        return;
      }
      const filled = await res.text();
      // Keep the full document for downloads…
      const dims = getSvgDimensions(filled);
      setRendered({ fullSvg: filled, width: dims.width, height: dims.height });
      // …but preview the content-focused version so it isn't mostly empty.
      const focused = focusSvgToContent(filled);
      setPreview(URL.createObjectURL(svgStringToBlob(focused)));
      // Remember which song this preview reflects, to flag later changes.
      setRenderedKey(songKey(await fetchNowPlaying()));
    } catch {
      setError("Could not reach the backend. Is it running on port 3000?");
    } finally {
      setLoading(false);
    }
  }

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

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!dragging) setDragging(true);
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
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

  if (!connected) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-6">
        <p className="text-sm text-neutral-300">
          Connect your Spotify account to use this tool.
        </p>
        <a
          href={`${BACKEND_URL}/api/auth/spotify/login`}
          className="mt-4 inline-block rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
        >
          Connect Spotify
        </a>
      </div>
    );
  }

  const liveKey = songKey(nowPlaying);
  const songChanged = Boolean(
    previewUrl && renderedKey && liveKey && liveKey !== renderedKey,
  );

  return (
    <div className="space-y-6">
      <div className="text-sm text-neutral-400">
        {!nowPlaying?.playing ? (
          "Nothing is playing on Spotify right now."
        ) : nowPlaying.supported === false ? (
          <span className="text-amber-400">
            Spotify is playing {unsupportedLabel(nowPlaying.type)} — only songs
            are supported.
          </span>
        ) : (
          <>
            Now playing:{" "}
            <span className="text-neutral-100">
              {nowPlaying.artist} — {nowPlaying.title}
            </span>
          </>
        )}
      </div>

      {/* Drag-and-drop zone (also click-to-browse). */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragging
            ? "border-green-500 bg-green-500/10"
            : "border-neutral-700 bg-neutral-900/30"
        }`}
      >
        <p className="text-sm text-neutral-300">
          Drag &amp; drop an SVG template here
        </p>
        <p className="mt-1 text-xs text-neutral-500">or</p>
        <label className="mt-2 inline-block cursor-pointer rounded-md border border-neutral-700 px-4 py-2 text-sm hover:border-neutral-500">
          Browse files
          <input
            type="file"
            accept=".svg,image/svg+xml"
            className="hidden"
            onChange={onFileChange}
          />
        </label>
        {templateName && (
          <p className="mt-3 text-xs text-neutral-400">Loaded: {templateName}</p>
        )}
      </div>

      {templateSvg && (
        <div className="space-y-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => render(templateSvg)}
            className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Rendering…" : "Re-render with current song"}
          </button>
          {songChanged && (
            <p className="text-xs text-amber-400">
              The playing song changed — re-render to update the preview.
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {previewUrl && rendered && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
          <p className="mb-3 text-xs uppercase tracking-wider text-neutral-500">
            Preview (cropped to artwork)
          </p>
          {/* Rendered as <img> (not inline) so an uploaded SVG can't run scripts. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Rendered template preview"
            className="mx-auto max-h-[24rem] w-auto"
          />

          {/* Downloads — always export the FULL document, not the crop. */}
          <div className="mt-4 space-y-3 border-t border-neutral-800 pt-4">
            <button
              type="button"
              onClick={downloadSvg}
              className="rounded-md border border-neutral-700 px-4 py-2 text-sm hover:border-neutral-500"
            >
              Download SVG
            </button>

            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col text-xs text-neutral-500">
                PNG resolution
                <select
                  value={pngScale}
                  onChange={(e) => setPngScale(e.target.value as PngScale)}
                  className="mt-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
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
                  <label className="flex flex-col text-xs text-neutral-500">
                    Width
                    <input
                      type="number"
                      min={1}
                      max={MAX_PX}
                      value={customW}
                      onChange={(e) => onCustomWidth(e.target.value)}
                      className="mt-1 w-24 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                    />
                  </label>
                  <span className="pb-2 text-neutral-500">×</span>
                  <label className="flex flex-col text-xs text-neutral-500">
                    Height
                    <input
                      type="number"
                      min={1}
                      max={MAX_PX}
                      value={customH}
                      onChange={(e) => onCustomHeight(e.target.value)}
                      className="mt-1 w-24 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                    />
                  </label>
                </div>
              )}

              <button
                type="button"
                onClick={downloadPng}
                disabled={exporting}
                className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
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
