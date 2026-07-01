import { cookies } from "next/headers";
import Sidebar from "@/features/dashboard/Sidebar";
import ToolsSection from "@/features/dashboard/ToolsSection";
import { BACKEND_URL } from "@/shared/config";
import type { ApiConnection, SpotifyProfile, Tool } from "@/shared/types";

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
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar connections={connections} loggedIn={loggedIn} />
      <main className="flex-1 px-8 py-12 md:px-16">
        <h1 className="type-display-lg text-on-surface">Dashboard</h1>
        <p className="mt-3 type-body-lg text-on-surface-variant">
          Available tools for processing your music streaming data.
        </p>

        <ToolsSection
          tools={tools}
          spotifyConnected={spotifyConnected}
          loggedIn={loggedIn}
        />

        {profile && (
          <section className="mt-12 border border-outline-variant bg-surface-container-lowest p-6">
            <h2 className="type-label-sm text-primary">
              Spotify connected — test fetch of /v1/me
            </h2>
            <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="type-label-sm text-on-surface-variant">Display name</dt>
              <dd className="text-on-surface">{profile.display_name ?? "—"}</dd>
              <dt className="type-label-sm text-on-surface-variant">User ID</dt>
              <dd className="text-on-surface">{profile.id}</dd>
              {profile.email && (
                <>
                  <dt className="type-label-sm text-on-surface-variant">Email</dt>
                  <dd className="text-on-surface">{profile.email}</dd>
                </>
              )}
              {profile.product && (
                <>
                  <dt className="type-label-sm text-on-surface-variant">Plan</dt>
                  <dd className="capitalize text-on-surface">{profile.product}</dd>
                </>
              )}
            </dl>
          </section>
        )}
      </main>
    </div>
  );
}
