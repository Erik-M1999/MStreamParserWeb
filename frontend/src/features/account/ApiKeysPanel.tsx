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

  if (loggedIn === null) return <p className="text-sm text-neutral-500">Loading…</p>;

  if (!loggedIn) {
    return (
      <p className="text-sm text-neutral-300">
        Please{" "}
        <Link href="/login" className="text-green-400 hover:underline">
          log in
        </Link>{" "}
        to manage API keys.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-neutral-400">
        API keys let external tools (e.g. 3Ds Max) access your account. Send the key
        as <code className="text-neutral-300">Authorization: Bearer &lt;key&gt;</code>.
        Treat it like a password.
      </p>

      {/* Create */}
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name (e.g. 3Ds Max)"
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        />
        <button
          type="button"
          onClick={onCreate}
          disabled={busy || !name.trim()}
          className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create key"}
        </button>
      </div>

      {/* Just-created key, shown once */}
      {created && (
        <div className="rounded-md border border-green-900/60 bg-green-500/5 p-4">
          <p className="text-sm font-medium text-green-400">
            Copy your key now — you won&apos;t see it again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-neutral-900 px-2 py-1 text-xs text-neutral-100">
              {created.key}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(created.key)}
              className="rounded-md border border-neutral-700 px-3 py-1 text-xs hover:border-neutral-500"
            >
              Copy
            </button>
          </div>
          <p className="mt-3 text-xs text-neutral-500">Test it:</p>
          <code className="mt-1 block break-all rounded bg-neutral-900 px-2 py-1 text-xs text-neutral-400">
            curl -H &quot;Authorization: Bearer {created.key}&quot; {BACKEND_URL}/api/v1/whoami
          </code>
        </div>
      )}

      {error && (
        <p className="rounded-md border border-red-900/60 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* List */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Your keys
        </h3>
        {keys.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No keys yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-800 rounded-md border border-neutral-800">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-neutral-200">{k.name}</p>
                  <p className="text-xs text-neutral-500">
                    created {new Date(k.createdAt).toLocaleDateString()} ·{" "}
                    {k.lastUsedAt
                      ? `last used ${new Date(k.lastUsedAt).toLocaleString()}`
                      : "never used"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRevoke(k.id)}
                  className="shrink-0 rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:border-red-700 hover:text-red-400"
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
