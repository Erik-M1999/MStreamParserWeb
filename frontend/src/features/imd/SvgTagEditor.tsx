"use client";

import { useEffect, useMemo, useState } from "react";
import { analyzeSvg, applyTags, suggestSlot } from "@/features/imd/lib/tagEditor";

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
  }, [analysis]);

  function setAssignment(ref: number, slot: string | null) {
    setAssignments((prev) => {
      const next = { ...prev };
      if (slot) {
        // One element per slot: clear this slot from any other element.
        for (const k of Object.keys(next)) {
          if (next[Number(k)] === slot) next[Number(k)] = null;
        }
      }
      next[ref] = slot;
      return next;
    });
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
                className="flex items-center justify-between gap-2 rounded border border-outline-variant px-2 py-1.5 text-sm"
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
                  <option value="">— none —</option>
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

      {/* Read-only source (no free editing — prevents injection). */}
      <div>
        <p className="text-xs uppercase tracking-wider text-on-surface-variant">
          SVG source (read-only)
        </p>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-outline-variant bg-surface-container-lowest p-2 text-[11px] leading-relaxed text-on-surface-variant">
          {svg}
        </pre>
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
