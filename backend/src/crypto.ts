import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Symmetric encryption for secrets at rest (Spotify access/refresh tokens).
//
// AES-256-GCM (authenticated): tampering is detected on decrypt. The 32-byte
// key is derived from TOKEN_ENC_KEY in .env, so any non-empty secret works as
// key material.
//
// Stored format: "<version>:<iv>:<authTag>:<ciphertext>" (each part base64).
//
//   v2 (current) — key = HKDF-SHA256(TOKEN_ENC_KEY, salt, info)
//   v1 (read-only) — key = plain SHA-256(TOKEN_ENC_KEY)
//
// v1 is still *readable* so rows written before the change keep working; every
// value is rewritten as v2 the next time it is stored (Spotify tokens get
// rewritten on each refresh, so v1 rows disappear on their own within an hour
// of active use). Nothing writes v1 any more.
//
// Unencrypted values are rejected outright — a plaintext passthrough would let
// anyone with database write access opt out of encryption entirely.
// ---------------------------------------------------------------------------

const VERSION = "v2"; // what we write
const LEGACY_VERSION = "v1"; // what we still read
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // standard nonce size for GCM
const TAG_BYTES = 16; // full-length GCM auth tag — short tags weaken forgery resistance

// Fixed salt + info: TOKEN_ENC_KEY is a single long-lived application secret,
// not a per-user password, so there is nothing to vary them by. They exist to
// domain-separate this key from any other use of the same secret.
const HKDF_SALT = Buffer.from("mstreamparserweb:token-enc:v2");
const HKDF_INFO = Buffer.from("spotify-token-encryption");

function secretMaterial(): string {
  const secret = process.env.TOKEN_ENC_KEY ?? "";
  if (!secret) {
    throw new Error(
      "TOKEN_ENC_KEY is not set — cannot encrypt secrets at rest. Add it to backend/.env.",
    );
  }
  return secret;
}

/** Current key derivation. HKDF gives proper domain separation and does not
 *  hand an attacker a single raw SHA-256 to brute-force a weak passphrase against. */
function key(): Buffer {
  return Buffer.from(
    crypto.hkdfSync("sha256", secretMaterial(), HKDF_SALT, HKDF_INFO, 32),
  );
}

/** v1 key derivation — kept only so existing rows can still be read. */
function legacyKey(): Buffer {
  return crypto.createHash("sha256").update(secretMaterial()).digest();
}

/** Encrypts a plaintext secret for storage (always the current version). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key(), iv, {
    authTagLength: TAG_BYTES,
  });
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

/** Decrypts a stored secret. Throws on anything that is not a v1/v2 value. */
export function decryptSecret(stored: string): string {
  const [version, ivB64, tagB64, ctB64] = stored.split(":");
  if (version !== VERSION && version !== LEGACY_VERSION) {
    throw new Error(
      "Stored secret is not encrypted (or uses an unknown format) — refusing to use it.",
    );
  }

  const iv = Buffer.from(ivB64 ?? "", "base64");
  const tag = Buffer.from(tagB64 ?? "", "base64");
  const ct = Buffer.from(ctB64 ?? "", "base64");

  // Reject anything but a full 16-byte tag. Node would otherwise accept a
  // truncated tag, which makes forgery dramatically cheaper; authTagLength on
  // the decipher enforces the same bound a second time.
  if (tag.length !== TAG_BYTES) {
    throw new Error("Malformed encrypted value: bad authentication tag length.");
  }

  const decipher = crypto.createDecipheriv(
    ALGO,
    version === VERSION ? key() : legacyKey(),
    iv,
    { authTagLength: TAG_BYTES },
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
