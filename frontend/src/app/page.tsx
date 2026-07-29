"use client";

import { useCallback, useEffect, useState } from "react";
import Sidebar from "@/features/dashboard/Sidebar";
import ToolsShell from "@/features/dashboard/ToolsShell";
import Welcome from "@/features/welcome/Welcome";
import { authFetch } from "@/shared/lib/authFetch";
import type {
  ApiConnection,
  SpotifyProfile,
  LastfmProfile,
  Tool,
} from "@/shared/types";

// The home page is a CLIENT Component: the static export (Path A) has no server
// at request time, so per-user data (login state, connected APIs, profiles) is
// fetched in the browser against /api after mount. The auth cookie rides along
// automatically (authFetch sends credentials). The landing content (<Welcome/>)
// renders immediately; the sidebar/tools fill in once the fetches resolve.
export default function HomePage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [connections, setConnections] = useState<ApiConnection[]>([]);
  const [loggedIn, setLoggedIn] = useState(false);
  const [spotifyProfile, setSpotifyProfile] = useState<SpotifyProfile | null>(null);
  const [lastfmProfile, setLastfmProfile] = useState<LastfmProfile | null>(null);

  // Reusable so a connect/disconnect in the sidebar can refresh the status
  // (router.refresh() does nothing here — this is client-fetched, not SSR).
  const load = useCallback(async () => {
    async function getJson<T>(path: string): Promise<T | null> {
      try {
        const res = await authFetch(path);
        return res.ok ? ((await res.json()) as T) : null;
      } catch {
        return null;
      }
    }

    const [toolsData, connData, meOk] = await Promise.all([
      getJson<Tool[]>("/api/tools"),
      getJson<ApiConnection[]>("/api/connections"),
      authFetch("/api/auth/me")
        .then((r) => r.ok)
        .catch(() => false),
    ]);

    const conns = connData ?? [];
    setTools(toolsData ?? []);
    setConnections(conns);
    setLoggedIn(meOk);

    const spotifyConnected = conns.some((c) => c.id === "spotify" && c.connected);
    const lastfmConnected = conns.some((c) => c.id === "lastfm" && c.connected);

    const [spotify, lastfm] = await Promise.all([
      spotifyConnected ? getJson<SpotifyProfile>("/api/spotify/me") : Promise.resolve(null),
      lastfmConnected ? getJson<LastfmProfile>("/api/lastfm/me") : Promise.resolve(null),
    ]);
    setSpotifyProfile(spotify);
    setLastfmProfile(lastfm);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const spotifyConnected = connections.some((c) => c.id === "spotify" && c.connected);
  const lastfmConnected = connections.some((c) => c.id === "lastfm" && c.connected);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        connections={connections}
        loggedIn={loggedIn}
        spotifyProfile={spotifyProfile}
        lastfmProfile={lastfmProfile}
        onConnectionsChanged={load}
      />
      <ToolsShell
        tools={tools}
        spotifyConnected={spotifyConnected}
        lastfmConnected={lastfmConnected}
        loggedIn={loggedIn}
      >
        <Welcome />
      </ToolsShell>
    </div>
  );
}
