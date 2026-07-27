"use client";

import { useRef, useState } from "react";

export interface StatusRow {
  label: string;
  value: string;
}

// The "?" affordance inside a connected API row. The row itself isn't
// clickable; hovering (or focusing) the "?" reveals a status overview.
//
// The panel is position:fixed and measured from the button, which escapes the
// sidebar's overflow-y-auto clipping (a position:absolute panel got cut off).
export default function ApiStatusButton({
  name,
  rows,
}: {
  name: string;
  rows: StatusRow[];
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function show() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      top: Math.max(8, Math.min(r.top, window.innerHeight - 200)),
      left: r.right + 8,
    });
  }

  return (
    <span
      className="flex shrink-0"
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
    >
      <button
        ref={btnRef}
        type="button"
        aria-label={`${name} status`}
        onFocus={show}
        onBlur={() => setPos(null)}
        className="flex h-5 w-5 items-center justify-center border border-outline-variant type-label-sm text-on-surface-variant transition-colors hover:border-success hover:text-success"
      >
        ?
      </button>

      {pos && (
        <div
          role="tooltip"
          style={{ top: pos.top, left: pos.left }}
          className="pointer-events-none fixed z-[60] w-64 border border-outline bg-surface-container-high p-3"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
            <span className="type-label-bold text-success">Connected</span>
          </div>

          {rows.length > 0 ? (
            <dl className="mt-3 space-y-1.5 text-xs">
              {rows.map((row) => (
                <div key={row.label} className="flex justify-between gap-3">
                  <dt className="shrink-0 text-on-surface-variant">{row.label}</dt>
                  <dd className="truncate text-on-surface">{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-3 text-xs text-on-surface-variant">
              No account details available.
            </p>
          )}
        </div>
      )}
    </span>
  );
}
