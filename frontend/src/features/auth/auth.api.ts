// Auth feature API: who-am-I and logout. Built on the shared authFetch helper.

import { authFetch } from "@/shared/lib/authFetch";

export interface Me {
  id: number;
  username: string;
  email: string;
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

/** Permanently deletes the account (password re-confirmation). Throws with the
 *  server's message on failure (e.g. wrong password). */
export async function deleteAccount(password: string): Promise<void> {
  const res = await authFetch("/api/auth/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Delete failed (${res.status}).`);
  }
}
