import { authJson } from "@/shared/lib/authFetch";

export interface ApiKeySummary {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** The plaintext `key` is present ONLY in the create response — shown once. */
export interface CreatedKey {
  id: number;
  name: string;
  key: string;
  createdAt: string;
}

export function listApiKeys(): Promise<ApiKeySummary[]> {
  return authJson<ApiKeySummary[]>("/api/keys");
}

export function createApiKey(name: string): Promise<CreatedKey> {
  return authJson<CreatedKey>("/api/keys", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function revokeApiKey(id: number): Promise<void> {
  return authJson<void>(`/api/keys/${id}`, { method: "DELETE" });
}
