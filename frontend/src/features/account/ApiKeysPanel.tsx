"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BACKEND_URL } from "@/shared/config";
import { getMe } from "@/features/auth/auth.api";
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKeySummary,
  type CreatedKey,
} from "./account.api";

export default function ApiKeysPanel() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null); // null = checking
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setKeys(await listApiKeys());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load keys.");
    }
  }

  useEffect(() => {
    getMe().then((me) => {
      if (!me) {
        setLoggedIn(false);
        return;
      }
      setLoggedIn(true);
      void refresh();
    });
  }, []);

  async function onCreate() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const key = await createApiKey(name.trim());
      setCreated(key);
      setName("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the key.");
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(id: number) {
    if (!window.confirm("Revoke this key? Anything using it will stop working.")) return;
    try {
      await revokeApiKey(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke the key.");
    }
  }

  if (loggedIn === null)
    return <p className="text-sm text-on-surface-variant">Loading…</p>;

  if (!loggedIn) {
    return (
      <p className="text-sm text-on-surface">
        Please{" "}
        <Link href="/login" className="text-primary hover:underline">
          log in
        </Link>{" "}
        to manage API keys.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-on-surface-variant">
        API keys let external tools (e.g. 3Ds Max) access your account. Send the key
        as{" "}
        <code className="text-on-surface">Authorization: Bearer &lt;key&gt;</code>.
        Treat it like a password.
      </p>

      {/* Create */}
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name (e.g. 3Ds Max)"
          className="flex-1 border border-outline bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={onCreate}
          disabled={busy || !name.trim()}
          className="bg-primary px-4 py-2 type-label-bold uppercase text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create key"}
        </button>
      </div>

      {/* Just-created key, shown once */}
      {created && (
        <div className="border border-success bg-success/10 p-4">
          <p className="type-label-bold text-success">
            Copy your key now. You won&apos;t see it again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all bg-surface-container-lowest px-2 py-1 text-xs text-on-surface">
              {created.key}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(created.key)}
              className="border border-outline px-3 py-1 text-xs transition-colors hover:border-primary"
            >
              Copy
            </button>
          </div>
          <p className="mt-3 text-xs text-on-surface-variant">Test it:</p>
          <code className="mt-1 block break-all bg-surface-container-lowest px-2 py-1 text-xs text-on-surface-variant">
            curl -H &quot;Authorization: Bearer {created.key}&quot; {BACKEND_URL}/api/v1/whoami
          </code>
        </div>
      )}

      {error && (
        <p className="border border-error bg-error-container px-3 py-2 text-sm text-on-error-container">
          {error}
        </p>
      )}

      {/* List */}
      <div>
        <h3 className="type-label-sm text-on-surface-variant">Your keys</h3>
        {keys.length === 0 ? (
          <p className="mt-2 text-sm text-on-surface-variant">No keys yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-outline-variant border border-outline-variant">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-on-surface">{k.name}</p>
                  <p className="text-xs text-on-surface-variant">
                    created {new Date(k.createdAt).toLocaleDateString()} ·{" "}
                    {k.lastUsedAt
                      ? `last used ${new Date(k.lastUsedAt).toLocaleString()}`
                      : "never used"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRevoke(k.id)}
                  className="shrink-0 border border-outline px-3 py-1 text-xs text-on-surface-variant transition-colors hover:border-error hover:text-error"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
