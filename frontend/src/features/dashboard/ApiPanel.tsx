"use client";

import { useState } from "react";
import { BACKEND_URL } from "@/shared/config";
import { authFetch, authJson } from "@/shared/lib/authFetch";
import Modal from "@/shared/components/Modal";
import ApiStatusButton, { type StatusRow } from "@/features/dashboard/ApiStatusButton";
import type {
  ApiConnection,
  SpotifyProfile,
  LastfmProfile,
} from "@/shared/types";

// The interactive APIs list (Sidebar is a server component, so all the connect
// modals / callbacks live here). Spotify connects via OAuth link; Last.fm via a
// username-or-link form (no OAuth). Both surface a status "?" when connected.
export default function ApiPanel({
  connections,
  loggedIn,
  spotifyProfile,
  lastfmProfile,
  onChanged,
}: {
  connections: ApiConnection[];
  loggedIn: boolean;
  spotifyProfile?: SpotifyProfile | null;
  lastfmProfile?: LastfmProfile | null;
  /** Re-fetch connection status after a connect/disconnect. */
  onChanged?: () => void;
}) {
  const [lfmOpen, setLfmOpen] = useState(false);
  const [lfmInput, setLfmInput] = useState("");
  const [lfmBusy, setLfmBusy] = useState(false);
  const [lfmError, setLfmError] = useState<string | null>(null);

  function statusRows(id: string): StatusRow[] {
    if (id === "spotify" && spotifyProfile) {
      const r: StatusRow[] = [
        { label: "Name", value: spotifyProfile.display_name ?? "—" },
        { label: "User ID", value: spotifyProfile.id },
      ];
      if (spotifyProfile.email) r.push({ label: "Email", value: spotifyProfile.email });
      if (spotifyProfile.product) r.push({ label: "Plan", value: spotifyProfile.product });
      return r;
    }
    if (id === "lastfm" && lastfmProfile) {
      const r: StatusRow[] = [{ label: "User", value: lastfmProfile.username }];
      if (lastfmProfile.realname) r.push({ label: "Name", value: lastfmProfile.realname });
      if (lastfmProfile.playcount != null)
        r.push({ label: "Scrobbles", value: lastfmProfile.playcount.toLocaleString() });
      return r;
    }
    return [];
  }

  async function connectLastfm() {
    if (!lfmInput.trim()) return;
    setLfmBusy(true);
    setLfmError(null);
    try {
      await authJson("/api/lastfm/connect", {
        method: "POST",
        body: JSON.stringify({ username: lfmInput.trim() }),
      });
      setLfmOpen(false);
      setLfmInput("");
      onChanged?.();
    } catch (e) {
      setLfmError(e instanceof Error ? e.message : "Could not connect Last.fm.");
    } finally {
      setLfmBusy(false);
    }
  }

  async function disconnect(id: string, name: string) {
    if (!window.confirm(`Disconnect ${name}?`)) return;
    await authFetch(`/api/${id}/disconnect`, { method: "POST" });
    onChanged?.();
  }

  return (
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
                <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
                <span className="type-label-bold text-on-surface">{api.name}</span>
                <span className="ml-auto flex items-center gap-2">
                  <ApiStatusButton name={api.name} rows={statusRows(api.id)} />
                  <button
                    type="button"
                    onClick={() => disconnect(api.id, api.name)}
                    title={`Disconnect ${api.name}`}
                    aria-label={`Disconnect ${api.name}`}
                    className="flex h-5 w-5 items-center justify-center border border-outline-variant type-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                  >
                    ✕
                  </button>
                </span>
              </li>
            );
          }

          // Not connected. Spotify uses an OAuth link; Last.fm opens a form.
          // Anonymous users are sent to /login first (connecting needs an account).
          if (api.id === "spotify") {
            return (
              <li key={api.id}>
                <a
                  href={loggedIn ? `${BACKEND_URL}/api/auth/spotify/login` : "/login"}
                  className="flex items-center gap-2 border border-outline-variant bg-surface-container-lowest px-3 py-2 transition-colors hover:border-primary"
                >
                  <span aria-hidden className="h-2 w-2 rounded-full bg-surface-dim" />
                  <span className="type-label-bold text-on-surface">{api.name}</span>
                  <span className="ml-auto type-label-sm text-primary">Connect</span>
                </a>
              </li>
            );
          }

          return (
            <li key={api.id}>
              <button
                type="button"
                onClick={() =>
                  loggedIn ? setLfmOpen(true) : (window.location.href = "/login")
                }
                className="flex w-full items-center gap-2 border border-outline-variant bg-surface-container-lowest px-3 py-2 transition-colors hover:border-primary"
              >
                <span aria-hidden className="h-2 w-2 rounded-full bg-surface-dim" />
                <span className="type-label-bold text-on-surface">{api.name}</span>
                <span className="ml-auto type-label-sm text-primary">Connect</span>
              </button>
            </li>
          );
        })}
      </ul>

      <Modal
        open={lfmOpen}
        onClose={() => setLfmOpen(false)}
        title="Connect Last.fm"
        size="small"
      >
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant">
            Enter your Last.fm username or profile link. Read-only.
          </p>
          <input
            type="text"
            autoFocus
            value={lfmInput}
            onChange={(e) => setLfmInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && connectLastfm()}
            placeholder="username or last.fm/user/…"
            className="w-full border border-outline bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
          />
          {lfmError && (
            <p className="border border-error bg-error-container px-3 py-2 text-sm text-on-error-container">
              {lfmError}
            </p>
          )}
          <button
            type="button"
            onClick={connectLastfm}
            disabled={lfmBusy || !lfmInput.trim()}
            className="w-full bg-primary px-4 py-2 type-label-bold uppercase text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
          >
            {lfmBusy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </Modal>
    </nav>
  );
}
