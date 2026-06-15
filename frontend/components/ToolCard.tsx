import Link from "next/link";
import type { Tool } from "@/types";

export default function ToolCard({ tool }: { tool: Tool }) {
  const isAvailable = tool.status === "available";

  const inner = (
    <>
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{tool.name}</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            isAvailable
              ? "bg-green-500/15 text-green-400"
              : "bg-neutral-700/40 text-neutral-400"
          }`}
        >
          {isAvailable ? "Available" : "Coming soon"}
        </span>
      </div>
      <p className="mt-2 text-sm text-neutral-400">{tool.description}</p>
    </>
  );

  const baseClasses =
    "block rounded-lg border border-neutral-800 bg-neutral-900/50 p-5";

  // Functional tools (with a route) are clickable; others are static cards.
  if (tool.href) {
    return (
      <Link
        href={tool.href}
        className={`${baseClasses} transition-colors hover:border-neutral-600 hover:bg-neutral-900`}
      >
        {inner}
      </Link>
    );
  }

  return <div className={baseClasses}>{inner}</div>;
}
