import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Symmetric encryption for secrets at rest (Spotify access/refresh tokens).
//
// AES-256-GCM (authenticated): tampering is detected on decrypt. The 32-byte
// key is derived by SHA-256 over TOKEN_ENC_KEY from .env, so any non-empty
// secret string works as the key material.
//
// Stored format: "v1:<iv>:<authTag>:<ciphertext>" (each part base64).
// decryptSecret tolerates legacy *plaintext* values (no "v1:" prefix) so rows
// written before encryption was added keep working until they're next rewritten.
// ---------------------------------------------------------------------------

const PREFIX = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // standard nonce size for GCM
const TAG_BYTES = 16; // full-length GCM auth tag — short tags weaken forgery resistance

function key(): Buffer {
  const secret = process.env.TOKEN_ENC_KEY ?? "";
  if (!secret) {
    throw new Error(
      "TOKEN_ENC_KEY is not set — cannot encrypt secrets at rest. Add it to backend/.env.",
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

/** Encrypts a plaintext secret for storage. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

/** Decrypts a stored secret. Passes through legacy plaintext untouched. */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(`${PREFIX}:`)) return stored; // legacy plaintext
  const [, ivB64, tagB64, ctB64] = stored.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  // Reject anything but a full 16-byte tag. Node would otherwise accept a
  // truncated tag, which makes forgery dramatically cheaper; authTagLength on
  // the decipher enforces the same bound a second time.
  if (tag.length !== TAG_BYTES) {
    throw new Error("Malformed encrypted value: bad authentication tag length.");
  }
  const decipher = crypto.createDecipheriv(ALGO, key(), iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
