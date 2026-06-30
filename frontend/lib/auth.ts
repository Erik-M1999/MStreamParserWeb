// Client-side auth helpers. The JWT lives in an HttpOnly cookie, so JS can't
// read it — we always send credentials and ask the backend who we are.

import { BACKEND_URL } from "@/config";

export interface Me {
  id: number;
  username: string;
  email: string;
}

/** fetch() against the backend with the auth cookie always included. */
export function authFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${BACKEND_URL}${path}`, { ...opts, credentials: "include" });
}

/** Convenience JSON helper that throws on non-2xx (with the server's message). */
export async function authJson<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await authFetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${res.status}).`);
  }
  // 204 No Content -> nothing to parse
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export async function getMe(): Promise<Me | null> {
  try {
    const res = await authFetch("/api/auth/me");
    return res.ok ? ((await res.json()) as Me) : null;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await authFetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
}
