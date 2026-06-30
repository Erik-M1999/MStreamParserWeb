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
