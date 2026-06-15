import type { ApiConnection } from "@/types";

// Presentational, no interactivity -> stays a Server Component (no "use client").
export default function TopBar({ connections }: { connections: ApiConnection[] }) {
  return (
    <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
      <span className="font-semibold tracking-tight">MStreamParserWeb</span>

      <nav className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wider text-neutral-500">
          APIs
        </span>
        {connections.map((api) => (
          <span
            key={api.id}
            className="flex items-center gap-1.5 rounded-full border border-neutral-800 px-3 py-1 text-sm"
          >
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${
                api.connected ? "bg-green-500" : "bg-neutral-600"
              }`}
            />
            {api.name}
            <span className="text-xs text-neutral-500">
              {api.connected ? "connected" : "not connected"}
            </span>
          </span>
        ))}
      </nav>
    </header>
  );
}
