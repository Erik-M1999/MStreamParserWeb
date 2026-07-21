import type { Tool } from "@/shared/types";

export default function ToolCard({
  tool,
  onOpen,
}: {
  tool: Tool;
  onOpen?: () => void;
}) {
  const isAvailable = tool.status === "available";

  const inner = (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="type-headline-md text-on-surface">{tool.name}</h2>
        {/* Available tools need no badge — only flag the ones that aren't yet. */}
        {!isAvailable && (
          <span className="bg-surface-container-high px-2 py-1 type-label-sm text-on-surface-variant">
            Coming soon
          </span>
        )}
      </div>
      <p className="mt-3 type-body-lg text-on-surface-variant">{tool.description}</p>
    </>
  );

  // Flat, sharp-cornered white card with a 1px outline (no shadow — DESIGN.md).
  const baseClasses =
    "block w-full border border-outline-variant bg-surface-container-lowest p-6 text-left";

  // Functional tools open in a modal; others are static cards.
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        data-cy={`tool-${tool.id}`}
        className={`${baseClasses} transition-colors hover:border-primary`}
      >
        {inner}
      </button>
    );
  }

  return <div className={baseClasses}>{inner}</div>;
}
