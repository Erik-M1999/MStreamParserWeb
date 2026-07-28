import crypto from "node:crypto";
import { prisma } from "../db.js";
import { encryptSecret } from "../crypto.js";

// ---------------------------------------------------------------------------
// One-time migration: re-encrypt stored secrets from the v1 format to v2.
//
//   v1 key = SHA-256(TOKEN_ENC_KEY)                  (single pass, no salt)
//   v2 key = HKDF-SHA256(TOKEN_ENC_KEY, salt, info)  (domain-separated)
//
// crypto.ts no longer reads v1 at all, so this must run BEFORE the new build
// starts serving traffic — otherwise every Spotify call fails until the user
// reconnects. Deploy order:
//
//   1. upload the new build            2. npm run migrate:tokens
//   3. restart the app
//
// Idempotent and safe to re-run: rows already at v2 are counted and skipped.
// Run with:  npm run migrate:tokens
// ---------------------------------------------------------------------------

const ALGO = "aes-256-gcm";
const TAG_BYTES = 16;

/** The v1 derivation, kept here (and ONLY here) so the runtime doesn't carry it. */
function legacyKey(): Buffer {
  const secret = process.env.TOKEN_ENC_KEY ?? "";
  if (!secret) throw new Error("TOKEN_ENC_KEY is not set — cannot migrate.");
  return crypto.createHash("sha256").update(secret).digest();
}

function decryptV1(stored: string): string {
  const [, ivB64, tagB64, ctB64] = stored.split(":");
  const tag = Buffer.from(tagB64 ?? "", "base64");
  if (tag.length !== TAG_BYTES) {
    throw new Error("Malformed v1 value: bad authentication tag length.");
  }
  const decipher = crypto.createDecipheriv(
    ALGO,
    legacyKey(),
    Buffer.from(ivB64 ?? "", "base64"),
    { authTagLength: TAG_BYTES },
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64 ?? "", "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Upgrades one stored value. Returns null when nothing needs doing (already v2),
 * so the caller can skip the write. Throws on anything that is neither v1 nor v2.
 */
export function upgradeValue(stored: string): string | null {
  const version = stored.split(":")[0];
  if (version === "v2") return null;
  if (version !== "v1") {
    throw new Error(`Unrecognised stored secret format: "${version}".`);
  }
  return encryptSecret(decryptV1(stored));
}

async function main() {
  const rows = await prisma.connection.findMany({
    select: { id: true, provider: true, accessToken: true, refreshToken: true },
  });

  let upgraded = 0;
  let skipped = 0;
  const failed: number[] = [];

  for (const row of rows) {
    try {
      const accessToken = upgradeValue(row.accessToken);
      const refreshToken = upgradeValue(row.refreshToken);
      if (accessToken === null && refreshToken === null) {
        skipped++;
        continue;
      }
      await prisma.connection.update({
        where: { id: row.id },
        data: {
          ...(accessToken !== null ? { accessToken } : {}),
          ...(refreshToken !== null ? { refreshToken } : {}),
        },
      });
      upgraded++;
    } catch (err) {
      // Keep going: one unreadable row shouldn't stop the rest. A failure here
      // means that connection needs to be re-authorized by hand.
      failed.push(row.id);
      console.error(
        `[migrate:tokens] connection id=${row.id} (${row.provider}) failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `[migrate:tokens] ${rows.length} connection(s): ` +
      `${upgraded} upgraded, ${skipped} already v2, ${failed.length} failed.`,
  );
  if (failed.length > 0) {
    console.error(
      `[migrate:tokens] ids needing a manual reconnect: ${failed.join(", ")}`,
    );
    process.exitCode = 1;
  }
}

// Only run when executed directly, so tests can import upgradeValue.
if (process.argv[1]?.includes("migrate-token-encryption")) {
  main()
    .catch((err) => {
      console.error("[migrate:tokens] failed:", err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
