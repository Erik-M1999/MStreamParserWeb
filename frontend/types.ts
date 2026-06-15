// Shared data shapes mirroring what the Express backend returns.
// Keeping them in one place avoids drift between the page and components.

export type ToolStatus = "available" | "coming-soon";

export interface Tool {
  id: string;
  name: string;
  description: string;
  status: ToolStatus;
}

export interface ApiConnection {
  id: string;
  name: string;
  /** Whether this API is connected in the current session. */
  connected: boolean;
}
