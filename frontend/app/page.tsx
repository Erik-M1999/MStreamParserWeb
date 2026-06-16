import TopBar from "@/components/TopBar";
import ToolsSection from "@/components/ToolsSection";
import { BACKEND_URL } from "@/config";
import type { ApiConnection, SpotifyProfile, Tool } from "@/types";

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

// Test fetch: ask the backend for the Spotify profile. Returns null if we're
// not connected (the backend answers 401) — we render a hint in that case.
async function getSpotifyProfile(): Promise<SpotifyProfile | null> {
  const res = await fetch(`${BACKEND_URL}/api/spotify/me`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

// This is a Server Component (the default in the App Router). The `await`s below
// run on the SERVER at request time — the HTML arrives already filled in.
// No useEffect, no client-side loading spinner.
export default async function HomePage() {
  const [tools, connections] = await Promise.all([getTools(), getConnections()]);
  const spotifyConnected = connections.some(
    (c) => c.id === "spotify" && c.connected,
  );
  const profile = spotifyConnected ? await getSpotifyProfile() : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col">
      <TopBar connections={connections} />
      <main className="flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Available tools for processing your music streaming data.
        </p>

        <ToolsSection tools={tools} spotifyConnected={spotifyConnected} />

        {profile && (
          <section className="mt-10 rounded-lg border border-green-900/50 bg-green-500/5 p-5">
            <h2 className="text-sm font-medium text-green-400">
              Spotify connected — test fetch of /v1/me
            </h2>
            <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
              <dt className="text-neutral-500">Display name</dt>
              <dd>{profile.display_name ?? "—"}</dd>
              <dt className="text-neutral-500">User ID</dt>
              <dd>{profile.id}</dd>
              {profile.email && (
                <>
                  <dt className="text-neutral-500">Email</dt>
                  <dd>{profile.email}</dd>
                </>
              )}
              {profile.product && (
                <>
                  <dt className="text-neutral-500">Plan</dt>
                  <dd className="capitalize">{profile.product}</dd>
                </>
              )}
            </dl>
          </section>
        )}
      </main>
    </div>
  );
}
