import { cookies } from "next/headers";
import Sidebar from "@/features/dashboard/Sidebar";
import ToolsShell from "@/features/dashboard/ToolsShell";
import Welcome from "@/features/welcome/Welcome";
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
      <Sidebar connections={connections} loggedIn={loggedIn} profile={profile} />
      <ToolsShell
        tools={tools}
        spotifyConnected={spotifyConnected}
        loggedIn={loggedIn}
      >
        <Welcome />
      </ToolsShell>
    </div>
  );
}
