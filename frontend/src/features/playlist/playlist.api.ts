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
  coverUrl: string | null;
  tracks: ExportedTrack[];
}

export interface PlaylistPage {
  playlists: PlaylistSummary[];
  total: number;
  hasMore: boolean;
  /** Play-recency ranking (newest first); only populated on the first page. */
  recentIds: string[];
}

/** One page of the current user's playlists (see listMyPlaylistsPage). */
export function listPlaylistsPage(offset = 0, limit = 50): Promise<PlaylistPage> {
  return authJson<PlaylistPage>(
    `/api/spotify/playlists?offset=${offset}&limit=${limit}`,
  );
}

/** A single playlist's tracks in order, ready to format. */
export function exportPlaylist(id: string): Promise<PlaylistExport> {
  return authJson<PlaylistExport>(`/api/spotify/playlists/${encodeURIComponent(id)}`);
}
