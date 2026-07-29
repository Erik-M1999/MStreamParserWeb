"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeSvg, applyTags, suggestSlot } from "@/features/imd/lib/tagEditor";
import { focusSvgToContent } from "@/features/imd/lib/focusSvg";
import { BACKEND_URL } from "@/shared/config";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Live-DOM taggable elements in document order. Includes <image> because a
 *  filled cover <rect> is swapped for an <image> in place — so index i still
 *  lines up with the plain template's Candidate `ref`. */
function liveCandidates(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    const t = (el.localName || el.tagName || "").toLowerCase();
    if (t === "text" || t === "rect" || t === "image") out.push(el);
    for (const c of Array.from(el.children)) walk(c);
  };
  for (const c of Array.from(root.children)) walk(c);
  return out;
}

export default function SvgTagEditor({
  svg,
  mode,
  onApply,
  onClose,
}: {
  svg: string;
  mode: string;
  onApply: (svg: string) => void;
  onClose: () => void;
}) {
  const analysis = useMemo(() => analyzeSvg(svg, mode), [svg, mode]);

  // Plain, artwork-focused preview. focusSvgToContent runs the template through
  // DOMPurify on every path, which is what makes the dangerouslySetInnerHTML
  // below safe — the markup is re-parsed there by the browser's lenient HTML
  // parser. `filled` (the live partial render) overrides it and is sanitized too.
  const plainPreview = useMemo(() => focusSvgToContent(svg), [svg]);
  const [filled, setFilled] = useState<string | null>(null);
  const displaySvg = filled ?? plainPreview;

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);

  const [assignments, setAssignments] = useState<Record<number, string | null>>(
    () => {
      const a: Record<number, string | null> = {};
      for (const c of analysis.candidates) a[c.ref] = c.tagValid ? c.currentTag : null;
      return a;
    },
  );

  // Re-initialize when the SVG (analysis) changes — e.g. a new file is dropped
  // while the editor is open — so it never refers to the previous template.
  useEffect(() => {
    const a: Record<number, string | null> = {};
    for (const c of analysis.candidates) a[c.ref] = c.tagValid ? c.currentTag : null;
    setAssignments(a);
    setFilled(null);
    setBox(null);
    setPreviewError(null);
  }, [analysis]);

  // Highlight the element a row maps to, in pixel space (transform/viewBox proof).
  function hoverElement(ref: number | null) {
    if (ref == null || !baseRef.current || !containerRef.current) {
      setBox(null);
      return;
    }
    const svgEl = baseRef.current.querySelector("svg");
    if (!svgEl) return setBox(null);
    const el = liveCandidates(svgEl)[ref] as SVGGraphicsElement | undefined;
    if (!el) return setBox(null);
    const er = el.getBoundingClientRect();
    if (er.width === 0 && er.height === 0) return setBox(null);
    const cr = containerRef.current.getBoundingClientRect();
    // Absolute children sit inside the container's border, so subtract it
    // (clientLeft/Top) or the box lands ~1px off. Pad so it sits just outside.
    const pad = 4;
    const bl = containerRef.current.clientLeft;
    const bt = containerRef.current.clientTop;
    setBox({
      left: er.left - cr.left - bl - pad,
      top: er.top - cr.top - bt - pad,
      width: er.width + pad * 2,
      height: er.height + pad * 2,
    });
  }

  async function renderPartial(taggedSvg: string) {
    setPreviewLoading(true);
    setPreviewError(null);
    setBox(null);
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/immersive/render?mode=${encodeURIComponent(mode)}`,
        {
          method: "POST",
          headers: { "Content-Type": "image/svg+xml" },
          credentials: "include",
          body: taggedSvg,
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setPreviewError(data.error ?? `Preview failed (${res.status}).`);
        return;
      }
      setFilled(focusSvgToContent(await res.text()));
    } catch {
      setPreviewError("Couldn't reach the backend for the preview.");
    } finally {
      setPreviewLoading(false);
    }
  }

  function setAssignment(ref: number, slot: string | null) {
    const next = { ...assignments };
    if (slot) {
      // One element per slot: clear this slot from any other element.
      for (const k of Object.keys(next)) {
        if (next[Number(k)] === slot) next[Number(k)] = null;
      }
    }
    next[ref] = slot;
    setAssignments(next);
    // Live partial preview inside the editor: fill with the tags so far. With
    // nothing tagged there's nothing to fill, so fall back to the plain view.
    if (Object.values(next).some(Boolean)) {
      void renderPartial(applyTags(svg, mode, next));
    } else {
      setFilled(null);
    }
  }

  const covered = new Set(Object.values(assignments).filter(Boolean) as string[]);

  if (!analysis.ok) {
    return (
      <div className="rounded-lg border border-error bg-error-container p-4 text-sm text-on-error-container">
        Couldn&apos;t parse this SVG.{" "}
        <button type="button" onClick={onClose} className="underline">
          Close
        </button>
      </div>
    );
  }

  const optionsFor = (kind: "text" | "image") =>
    analysis.slots.filter((s) => s.kind === kind).map((s) => s.slot);

  return (
    <div className="space-y-4 rounded-lg border border-outline-variant bg-surface-container-low p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Tag editor</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-on-surface-variant hover:text-on-surface"
        >
          Close
        </button>
      </div>

      {/* Preview: starts plain (no data), fills live as you assign tags.
          Hovering a row below outlines the element it maps to. */}
      <div>
        <p className="text-xs uppercase tracking-wider text-on-surface-variant">
          Preview {filled ? "(tags so far)" : "(plain)"}. Hover a row to locate it
          {previewLoading ? " · rendering…" : ""}
        </p>
        <div
          ref={containerRef}
          className="relative mt-2 flex h-64 items-center justify-center overflow-hidden rounded border border-outline-variant bg-surface-container-lowest"
        >
          <div
            ref={baseRef}
            aria-hidden
            className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: displaySvg }}
          />
          {box && (
            <div
              className="pointer-events-none absolute rounded-sm bg-green-500/30"
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            />
          )}
        </div>
        {previewError && (
          <p className="mt-1 text-xs text-error">{previewError}</p>
        )}
      </div>

      {/* Only surface the mandatory tags that are still missing (needed for the
          parser to work) — once they're all present this collapses to a tick. */}
      {(() => {
        const missing = analysis.slots.filter(
          (s) => s.required && !covered.has(s.slot),
        );
        return (
          <div>
            <p className="text-xs uppercase tracking-wider text-on-surface-variant">
              {missing.length ? "Missing mandatory tags" : "Mandatory tags"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {missing.length === 0 ? (
                <span className="rounded bg-success/10 px-2 py-0.5 text-xs text-success">
                  ✓ all present
                </span>
              ) : (
                missing.map((s) => (
                  <span
                    key={s.slot}
                    className="rounded bg-error-container px-2 py-0.5 text-xs text-error"
                  >
                    {s.slot}
                  </span>
                ))
              )}
            </div>
          </div>
        );
      })()}

      {/* Per-element tag assignment */}
      <div>
        <p className="text-xs uppercase tracking-wider text-on-surface-variant">
          Elements
        </p>
        <div className="mt-2 space-y-1">
          {analysis.candidates.length === 0 && (
            <p className="text-xs text-on-surface-variant">
              No text or image elements found.
            </p>
          )}
          {analysis.candidates.map((c) => {
            const invalid = c.currentTag != null && !c.tagValid;
            const suggestion = invalid
              ? suggestSlot(c.currentTag!, analysis.slots)
              : null;
            return (
              <div
                key={c.ref}
                onMouseEnter={() => hoverElement(c.ref)}
                onMouseLeave={() => hoverElement(null)}
                onFocus={() => hoverElement(c.ref)}
                onBlur={() => hoverElement(null)}
                className="flex items-center justify-between gap-2 rounded border border-outline-variant px-2 py-1.5 text-sm hover:border-primary"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-on-surface-variant">
                    {c.kind === "text" ? "T" : "▦"}
                  </span>
                  <span className="truncate text-on-surface">{c.label}</span>
                  {invalid && (
                    <button
                      type="button"
                      onClick={() => suggestion && setAssignment(c.ref, suggestion)}
                      title={suggestion ? `Set to "${suggestion}"` : undefined}
                      className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] text-amber-600 hover:bg-amber-500/25"
                    >
                      unknown: {c.currentTag}
                      {suggestion ? ` → ${suggestion}?` : ""}
                    </button>
                  )}
                </span>
                <select
                  value={assignments[c.ref] ?? ""}
                  onChange={(e) => setAssignment(c.ref, e.target.value || null)}
                  className="shrink-0 rounded border border-outline bg-surface-container-lowest px-2 py-1 text-xs text-on-surface"
                >
                  <option value="">- none -</option>
                  {optionsFor(c.kind).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {/* Read-only source (no free editing — prevents injection). Collapsed by
          default; most users only need the rows above. */}
      <div>
        <button
          type="button"
          onClick={() => setShowSource((s) => !s)}
          className="text-xs uppercase tracking-wider text-on-surface-variant hover:text-on-surface"
        >
          {showSource ? "▾" : "▸"} SVG source (read-only)
        </button>
        {showSource && (
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-outline-variant bg-surface-container-lowest p-2 text-[11px] leading-relaxed text-on-surface-variant">
            {svg}
          </pre>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-outline px-3 py-1.5 text-sm hover:border-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onApply(applyTags(svg, mode, assignments))}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary"
        >
          Apply tags
        </button>
      </div>
    </div>
  );
}
