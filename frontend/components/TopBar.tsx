import { BACKEND_URL } from "@/config";
import AuthStatus from "@/components/AuthStatus";
import type { ApiConnection } from "@/types";

// Maps an API id to the backend route that starts its OAuth login.
// Only Spotify exists for now; add more entries as we support more APIs.
const LOGIN_URLS: Record<string, string> = {
  spotify: `${BACKEND_URL}/api/auth/spotify/login`,
};

// Presentational, no interactivity -> stays a Server Component (no "use client").
// Clicking "Connect" is a plain link the browser navigates to (starts OAuth).
export default function TopBar({
  connections,
  loggedIn,
}: {
  connections: ApiConnection[];
  loggedIn: boolean;
}) {
  return (
    <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
      <span className="font-semibold tracking-tight">MStreamParserWeb</span>

      <nav className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wider text-neutral-500">
          APIs
        </span>
        {connections.map((api) => {
          if (api.connected) {
            return (
              <span
                key={api.id}
                className="flex items-center gap-1.5 rounded-full border border-neutral-800 px-3 py-1 text-sm"
              >
                <span aria-hidden className="h-2 w-2 rounded-full bg-green-500" />
                {api.name}
                <span className="text-xs text-neutral-500">connected</span>
              </span>
            );
          }

          // Connecting requires an account, so send anon users to /login.
          const href = loggedIn ? LOGIN_URLS[api.id] : "/login";
          return (
            <a
              key={api.id}
              href={href}
              className="flex items-center gap-1.5 rounded-full border border-neutral-800 px-3 py-1 text-sm transition-colors hover:border-neutral-600 hover:bg-neutral-900"
            >
              <span aria-hidden className="h-2 w-2 rounded-full bg-neutral-600" />
              {api.name}
              <span className="text-xs text-green-400">Connect</span>
            </a>
          );
        })}

        <AuthStatus />
      </nav>
    </header>
  );
}
