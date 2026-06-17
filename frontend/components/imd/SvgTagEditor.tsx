"use client";

import { useMemo, useState } from "react";
import { analyzeSvg, applyTags, suggestSlot } from "@/lib/imd/tagEditor";

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
      <div className="rounded-lg border border-red-900/60 bg-red-500/10 p-4 text-sm text-red-300">
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
    <div className="space-y-4 rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Tag editor</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-neutral-400 hover:text-neutral-200"
        >
          Close
        </button>
      </div>

      {/* Required tags for this mode */}
      <div>
        <p className="text-xs uppercase tracking-wider text-neutral-500">
          Required tags · {mode}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {analysis.slots
            .filter((s) => s.required)
            .map((s) => {
              const ok = covered.has(s.slot);
              return (
                <span
                  key={s.slot}
                  className={`rounded px-2 py-0.5 text-xs ${
                    ok
                      ? "bg-green-500/15 text-green-400"
                      : "bg-red-500/15 text-red-400"
                  }`}
                >
                  {ok ? "✓" : "✗"} {s.slot}
                </span>
              );
            })}
        </div>
      </div>

      {/* Per-element tag assignment */}
      <div>
        <p className="text-xs uppercase tracking-wider text-neutral-500">
          Elements
        </p>
        <div className="mt-2 space-y-1">
          {analysis.candidates.length === 0 && (
            <p className="text-xs text-neutral-500">
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
                className="flex items-center justify-between gap-2 rounded border border-neutral-800 px-2 py-1.5 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-neutral-500">
                    {c.kind === "text" ? "T" : "▦"}
                  </span>
                  <span className="truncate text-neutral-300">{c.label}</span>
                  {invalid && (
                    <button
                      type="button"
                      onClick={() => suggestion && setAssignment(c.ref, suggestion)}
                      title={suggestion ? `Set to "${suggestion}"` : undefined}
                      className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] text-amber-400 hover:bg-amber-500/25"
                    >
                      unknown: {c.currentTag}
                      {suggestion ? ` → ${suggestion}?` : ""}
                    </button>
                  )}
                </span>
                <select
                  value={assignments[c.ref] ?? ""}
                  onChange={(e) => setAssignment(c.ref, e.target.value || null)}
                  className="shrink-0 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
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
        <p className="text-xs uppercase tracking-wider text-neutral-500">
          SVG source (read-only)
        </p>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-neutral-800 bg-neutral-950 p-2 text-[11px] leading-relaxed text-neutral-400">
          {svg}
        </pre>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:border-neutral-500"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onApply(applyTags(svg, mode, assignments))}
          className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900"
        >
          Apply tags
        </button>
      </div>
    </div>
  );
}
