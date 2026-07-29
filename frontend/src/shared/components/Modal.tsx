"use client";

import { useEffect, type ReactNode } from "react";

export default function Modal({
  open,
  onClose,
  title,
  size = "default",
  headerExtra,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** "wide" gives tools with side-by-side panes more room; "small" suits
   *  compact dialogs like the Last.fm connect form; "medium" fits a
   *  text-heavy dialog without going full width. */
  size?: "small" | "medium" | "default" | "wide";
  /** Optional element shown next to the title (e.g. an info "i" button). */
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Prevent the page behind the modal from scrolling.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop — a high-transparency light gray wash (DESIGN.md prefers washes
          over floating shadowed boxes). */}
      <div
        className="absolute inset-0 bg-surface-dim/70"
        aria-hidden
        onClick={onClose}
      />

      {/* Flat window: sharp corners, 1px outline, no shadow. */}
      <div
        className={`relative z-10 flex max-h-[93vh] w-full ${
          size === "wide"
            ? "max-w-[104rem]"
            : size === "small"
              ? "max-w-md"
              : size === "medium"
                ? "max-w-3xl"
                : "max-w-5xl"
        } flex-col overflow-hidden border border-outline bg-surface-container-lowest`}
      >
        <div className="flex items-center justify-between border-b border-outline-variant px-6 py-4">
          <div className="flex items-center gap-3">
            <h2 className="type-label-bold uppercase text-on-surface">{title}</h2>
            {headerExtra}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="px-2 py-1 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
