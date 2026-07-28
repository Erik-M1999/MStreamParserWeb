import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Symmetric encryption for secrets at rest (Spotify access/refresh tokens).
//
// AES-256-GCM (authenticated): tampering is detected on decrypt. The 32-byte
// key is derived from TOKEN_ENC_KEY in .env, so any non-empty secret works as
// key material.
//
// Stored format: "v2:<iv>:<authTag>:<ciphertext>" (each part base64), with the
// key derived as HKDF-SHA256(TOKEN_ENC_KEY, salt, info).
//
// v1 (key = a single plain SHA-256 of TOKEN_ENC_KEY, no salt or stretching) is
// NOT readable here. Existing rows are converted up-front by
// scripts/migrate-token-encryption.ts, which owns the only remaining copy of
// that derivation — so the weak KDF cannot be reached from a served request.
//
// Unencrypted values are rejected outright too: a plaintext passthrough would
// let anyone with database write access opt out of encryption entirely.
// ---------------------------------------------------------------------------

const VERSION = "v2";
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

/** Decrypts a stored secret. Throws on anything that is not a current value. */
export function decryptSecret(stored: string): string {
  const [version, ivB64, tagB64, ctB64] = stored.split(":");
  if (version !== VERSION) {
    throw new Error(
      "Stored secret is not encrypted (or uses an unsupported format) — refusing to use it. " +
        "Legacy v1 rows must be converted first: npm run migrate:tokens",
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

  const decipher = crypto.createDecipheriv(ALGO, key(), iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
