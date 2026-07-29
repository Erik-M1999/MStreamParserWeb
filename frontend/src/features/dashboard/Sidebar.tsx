import AuthStatus from "@/features/auth/AuthStatus";
import ApiPanel from "@/features/dashboard/ApiPanel";
import type { ApiConnection, SpotifyProfile, LastfmProfile } from "@/shared/types";

// Dedicated left panel: brand at the top, the (growing) list of APIs in the
// middle (interactive -> ApiPanel client component), account pinned bottom.
export default function Sidebar({
  connections,
  loggedIn,
  spotifyProfile,
  lastfmProfile,
}: {
  connections: ApiConnection[];
  loggedIn: boolean;
  /** Account details surfaced on hover over each connected API's "?". */
  spotifyProfile?: SpotifyProfile | null;
  lastfmProfile?: LastfmProfile | null;
}) {
  return (
    <aside className="flex shrink-0 flex-col border-b border-outline-variant bg-surface-container-low md:sticky md:top-0 md:h-screen md:w-72 md:self-start md:border-b-0 md:border-r">
      {/* Brand */}
      <div className="border-b border-outline-variant px-6 py-6">
        <span className="type-headline-md text-on-surface">Music Streaming</span>
        <span className="block type-label-sm text-primary">Tools</span>
      </div>

      <ApiPanel
        connections={connections}
        loggedIn={loggedIn}
        spotifyProfile={spotifyProfile}
        lastfmProfile={lastfmProfile}
      />

      {/* Account overview */}
      <div className="border-t border-outline-variant px-6 py-6">
        <AuthStatus />
      </div>
    </aside>
  );
}
