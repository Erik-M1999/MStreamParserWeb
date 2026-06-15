import TopBar from "@/components/TopBar";
import ToolCard from "@/components/ToolCard";
import type { ApiConnection, Tool } from "@/types";

// The backend runs on 127.0.0.1 (not "localhost") to stay consistent with the
// Spotify API requirement we'll hit later.
const BACKEND_URL = "http://127.0.0.1:3000";

async function getTools(): Promise<Tool[]> {
  // cache: "no-store" -> fetch fresh on every request (dynamic rendering),
  // so the dashboard always reflects the backend's current state.
  const res = await fetch(`${BACKEND_URL}/api/tools`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load tools (${res.status})`);
  return res.json();
}

async function getConnections(): Promise<ApiConnection[]> {
  const res = await fetch(`${BACKEND_URL}/api/connections`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load connections (${res.status})`);
  return res.json();
}

// This is a Server Component (the default in the App Router). The `await`s below
// run on the SERVER at request time — the HTML arrives already filled in.
// No useEffect, no client-side loading spinner.
export default async function HomePage() {
  const [tools, connections] = await Promise.all([getTools(), getConnections()]);

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col">
      <TopBar connections={connections} />
      <main className="flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Available tools for processing your music streaming data.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      </main>
    </div>
  );
}
