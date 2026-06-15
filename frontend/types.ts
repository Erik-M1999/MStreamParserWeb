// Shared data shapes mirroring what the Express backend returns.
// Keeping them in one place avoids drift between the page and components.

export type ToolStatus = "available" | "coming-soon";

export interface Tool {
  id: string;
  name: string;
  description: string;
  status: ToolStatus;
  /** Frontend route this tool opens, if it's functional. */
  href?: string;
}

export interface ApiConnection {
  id: string;
  name: string;
  /** Whether this API is connected in the current session. */
  connected: boolean;
}

// Subset of Spotify's /v1/me response that we display in the test panel.
export interface SpotifyProfile {
  id: string;
  display_name: string | null;
  email?: string;
  product?: string;
  external_urls?: { spotify?: string };
}
