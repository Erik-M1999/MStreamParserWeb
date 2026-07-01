// Playlist Extractor — browser calls against the backend's Spotify routes.
import { authJson } from "@/shared/lib/authFetch";

export interface PlaylistSummary {
  id: string;
  name: string;
  owner: string;
  trackCount: number;
  coverUrl: string | null;
}

export interface ExportedTrack {
  position: number;
  artist: string;
  title: string;
}

export interface PlaylistExport {
  id: string;
  name: string;
  owner: string;
  tracks: ExportedTrack[];
}

/** The current user's saved/owned playlists. */
export async function listPlaylists(): Promise<PlaylistSummary[]> {
  const { playlists } = await authJson<{ playlists: PlaylistSummary[] }>(
    "/api/spotify/playlists",
  );
  return playlists;
}

/** A single playlist's tracks in order, ready to format. */
export function exportPlaylist(id: string): Promise<PlaylistExport> {
  return authJson<PlaylistExport>(`/api/spotify/playlists/${encodeURIComponent(id)}`);
}
