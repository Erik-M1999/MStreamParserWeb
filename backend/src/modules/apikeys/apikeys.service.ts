import crypto from "node:crypto";
import { prisma } from "../../db.js";
import { HttpError } from "../../shared/errors.js";

// ---------------------------------------------------------------------------
// ApiKeys context: issue / list / revoke personal API keys, and verify a key
// presented by an external tool (e.g. 3Ds Max). Keys are high-entropy random
// tokens, so we store a fast SHA-256 hash (looked up by the unique index) — the
// plaintext key is shown to the user exactly once, at creation.
//
// Public:   createKey, listKeys, revokeKey, verifyKey
// Internal: hashKey
// ---------------------------------------------------------------------------

const KEY_PREFIX = "msp_";

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/** Creates a key and returns the PLAINTEXT once (never retrievable again). */
export async function createKey(
  userId: number,
  name: unknown,
): Promise<{ id: number; name: string; key: string; createdAt: Date }> {
  if (typeof name !== "string" || !name.trim()) {
    throw new HttpError(400, "name is required.");
  }
  const key = KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
  const row = await prisma.apiKey.create({
    data: { userId, name: name.trim(), keyHash: hashKey(key) },
  });
  return { id: row.id, name: row.name, key, createdAt: row.createdAt };
}

export function listKeys(userId: number) {
  return prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdAt: true, lastUsedAt: true },
  });
}

export async function revokeKey(userId: number, id: number): Promise<void> {
  const r = await prisma.apiKey.deleteMany({ where: { id, userId } });
  if (r.count === 0) throw new HttpError(404, "API key not found.");
}

/** Verifies a presented key; returns the owning user, or null if invalid.
 *  Bumps lastUsedAt fire-and-forget so it never blocks the request. */
export async function verifyKey(
  presentedKey: string,
): Promise<{ userId: number; email: string; username: string } | null> {
  if (!presentedKey.startsWith(KEY_PREFIX)) return null;
  const row = await prisma.apiKey.findUnique({
    where: { keyHash: hashKey(presentedKey) },
    include: { user: true },
  });
  if (!row) return null;
  void prisma.apiKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return { userId: row.userId, email: row.user.email, username: row.user.username };
}
