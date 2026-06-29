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
import { IMD_DND_MIME, type ImdDragPayload } from "@/lib/imd/dragPayload";
import SvgTagEditor from "@/components/imd/SvgTagEditor";

export interface PendingTemplate {
  token: number;
  name: string;
  svg: string;
  mode: string;
}

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
const MAX_PX = 16384;

function clampInt(value: string | number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_PX, Math.max(1, n));
}

/**
 * Shared IMD workspace: upload/drag a template, render it filled with the
 * mode's Spotify data, preview (cropped), edit tags, and download (SVG/PNG).
 * Current-song uses its own component (it has extra live/long-text features).
 */
export default function ModeWorkspace({
  connected,
  mode,
  pendingTemplate,
}: {
  connected: boolean;
  mode: string;
  pendingTemplate?: PendingTemplate | null;
}) {
  const [templateSvg, setTemplateSvg] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loadedOk, setLoadedOk] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
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
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );
  useEffect(() => {
    if (rendered) {
      setCustomW(Math.round(rendered.width));
      setCustomH(Math.round(rendered.height));
    }
  }, [rendered]);

  async function render(svg: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/immersive/render?mode=${encodeURIComponent(mode)}`,
        { method: "POST", headers: { "Content-Type": "image/svg+xml" }, body: svg },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Render failed (${res.status}).`);
        setRendered(null);
        setPreview(null);
        setLoadedOk(false);
        return;
      }
      const filled = await res.text();
      setLoadedOk(true);
      const dims = getSvgDimensions(filled);
      setRendered({ fullSvg: filled, width: dims.width, height: dims.height });
      setPreview(URL.createObjectURL(svgStringToBlob(focusSvgToContent(filled))));
    } catch {
      setError("Could not reach the backend. Is it running on port 3000?");
      setLoadedOk(false);
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
        /* ignore */
      }
      return;
    }
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
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

  function onLoadedDragStart(e: DragEvent<HTMLDivElement>) {
    if (!templateSvg) return;
    const payload: ImdDragPayload = {
      name: templateName ?? "template",
      modes: [mode],
      svg: templateSvg,
    };
    e.dataTransfer.setData(IMD_DND_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "all";
  }

  // Load a template chosen from the library (only if it targets this mode).
  useEffect(() => {
    if (!pendingTemplate || pendingTemplate.mode !== mode) return;
    setTemplateSvg(pendingTemplate.svg);
    setTemplateName(pendingTemplate.name);
    void render(pendingTemplate.svg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTemplate?.token]);

  function handleApplyTags(newSvg: string) {
    setTemplateSvg(newSvg);
    setEditorOpen(false);
    void render(newSvg);
  }

  function fileBase(): string {
    if (templateName) {
      return (
        templateName
          .replace(/\.svg$/i, "")
          .replace(/[^\w.-]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 80) || `imd-${mode}`
      );
    }
    return `imd-${mode}`;
  }

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

  return (
    <div className="space-y-6">
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
            <p className={`text-sm ${loadedOk ? "text-green-400" : "text-amber-400"}`}>
              Loaded: {templateName}
            </p>
            <label className="cursor-pointer text-xs text-neutral-400 underline hover:text-neutral-200">
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
          </>
        )}
      </div>

      {templateSvg && (
        <div>
          <button
            type="button"
            onClick={() => setEditorOpen((o) => !o)}
            className="rounded-md border border-neutral-700 px-4 py-2 text-sm hover:border-neutral-500"
          >
            {editorOpen ? "Close tag editor" : "Edit tags"}
          </button>
          {editorOpen && (
            <div className="mt-2">
              <SvgTagEditor
                svg={templateSvg}
                mode={mode}
                onApply={handleApplyTags}
                onClose={() => setEditorOpen(false)}
              />
            </div>
          )}
        </div>
      )}

      {templateSvg && (
        <button
          type="button"
          disabled={loading}
          onClick={() => render(templateSvg)}
          className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Rendering…" : "Re-render"}
        </button>
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Rendered template preview"
            className="mx-auto max-h-[24rem] w-auto"
          />

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
