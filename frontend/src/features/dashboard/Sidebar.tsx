import { BACKEND_URL } from "@/shared/config";
import AuthStatus from "@/features/auth/AuthStatus";
import type { ApiConnection } from "@/shared/types";

// Maps an API id to the backend route that starts its OAuth login.
// Only Spotify exists for now; add more entries as we support more APIs.
const LOGIN_URLS: Record<string, string> = {
  spotify: `${BACKEND_URL}/api/auth/spotify/login`,
};

// Dedicated left panel. Brand at the top, the (growing) list of APIs in the
// middle, and the account overview pinned to the bottom. Presentational, no
// interactivity -> stays a Server Component ("Connect" is a plain OAuth link).
export default function Sidebar({
  connections,
  loggedIn,
}: {
  connections: ApiConnection[];
  loggedIn: boolean;
}) {
  return (
    <aside className="flex shrink-0 flex-col border-b border-outline-variant bg-surface-container-low md:h-screen md:w-72 md:border-b-0 md:border-r">
      {/* Brand */}
      <div className="border-b border-outline-variant px-6 py-6">
        <span className="type-headline-md text-on-surface">Music Streaming</span>
        <span className="block type-label-sm text-primary">Tools</span>
      </div>

      {/* APIs */}
      <nav className="flex-1 overflow-y-auto px-6 py-6">
        <h2 className="type-label-sm text-on-surface-variant">APIs</h2>
        <ul className="mt-4 flex flex-col gap-2">
          {connections.map((api) => {
            if (api.connected) {
              return (
                <li
                  key={api.id}
                  className="flex items-center gap-2 border border-outline-variant bg-surface-container-lowest px-3 py-2"
                >
                  <span aria-hidden className="h-2 w-2 rounded-full bg-primary" />
                  <span className="type-label-bold text-on-surface">{api.name}</span>
                  <span className="ml-auto type-label-sm text-on-surface-variant">
                    Connected
                  </span>
                </li>
              );
            }

            // Connecting requires an account, so send anon users to /login.
            const href = loggedIn ? LOGIN_URLS[api.id] : "/login";
            return (
              <li key={api.id}>
                <a
                  href={href}
                  className="flex items-center gap-2 border border-outline-variant bg-surface-container-lowest px-3 py-2 transition-colors hover:border-primary"
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full bg-surface-dim"
                  />
                  <span className="type-label-bold text-on-surface">{api.name}</span>
                  <span className="ml-auto type-label-sm text-primary">Connect</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Account overview */}
      <div className="border-t border-outline-variant px-6 py-6">
        <AuthStatus />
      </div>
    </aside>
  );
}
