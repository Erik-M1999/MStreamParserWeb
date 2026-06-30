import { cookies } from "next/headers";
import TopBar from "@/components/TopBar";
import ToolsSection from "@/components/ToolsSection";
import { BACKEND_URL } from "@/config";
import type { ApiConnection, SpotifyProfile, Tool } from "@/types";

// Server-side fetch that forwards the caller's auth cookie to the backend.
function backendGet(path: string, cookie: string): Promise<Response> {
  return fetch(`${BACKEND_URL}${path}`, {
    cache: "no-store",
    headers: cookie ? { cookie } : undefined,
  });
}

// This is a Server Component (the default in the App Router). The `await`s below
// run on the SERVER at request time — the HTML arrives already filled in.
export default async function HomePage() {
  const cookie = (await cookies()).toString();

  const [toolsRes, connectionsRes, meRes] = await Promise.all([
    backendGet("/api/tools", cookie),
    backendGet("/api/connections", cookie),
    backendGet("/api/auth/me", cookie),
  ]);

  const tools: Tool[] = toolsRes.ok ? await toolsRes.json() : [];
  const connections: ApiConnection[] = connectionsRes.ok
    ? await connectionsRes.json()
    : [];
  const loggedIn = meRes.ok;
  const spotifyConnected = connections.some(
    (c) => c.id === "spotify" && c.connected,
  );

  const profileRes = spotifyConnected
    ? await backendGet("/api/spotify/me", cookie)
    : null;
  const profile: SpotifyProfile | null =
    profileRes && profileRes.ok ? await profileRes.json() : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col">
      <TopBar connections={connections} loggedIn={loggedIn} />
      <main className="flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Available tools for processing your music streaming data.
        </p>

        <ToolsSection
          tools={tools}
          spotifyConnected={spotifyConnected}
          loggedIn={loggedIn}
        />

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
