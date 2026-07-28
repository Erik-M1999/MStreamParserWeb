import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { encryptSecret, decryptSecret } from "../src/crypto";

// Unit tests for the at-rest encryption helpers (pure logic — no DB/network).
// crypto.key() reads TOKEN_ENC_KEY at call time, so setting it here is enough.

beforeAll(() => {
  process.env.TOKEN_ENC_KEY = "test-key-for-unit-tests";
});

/** Builds a value in the retired v1 format (SHA-256 key, no HKDF). */
function makeV1(plain: string): string {
  const legacyKey = crypto
    .createHash("sha256")
    .update(process.env.TOKEN_ENC_KEY!)
    .digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", legacyKey, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

describe("encryptSecret / decryptSecret", () => {
  // Normal case
  it("round-trips a value back to the original plaintext", () => {
    const plain = "BQABCD-spotify-access-token";
    const enc = encryptSecret(plain);
    expect(enc).not.toBe(plain);
    expect(enc.startsWith("v2:")).toBe(true);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const plain = "same-input";
    expect(encryptSecret(plain)).not.toBe(encryptSecret(plain));
  });

  // Edge case: empty string
  it("handles an empty string", () => {
    const enc = encryptSecret("");
    expect(decryptSecret(enc)).toBe("");
  });

  // A plaintext passthrough would let anyone with DB write access opt out of
  // encryption, so an unversioned value is now an error rather than a value.
  it("refuses a plaintext (unencrypted) stored value", () => {
    expect(() => decryptSecret("legacy-plaintext-token")).toThrow(/not encrypted/i);
    expect(() => decryptSecret("")).toThrow(/not encrypted/i);
    expect(() => decryptSecret("v9:a:b:c")).toThrow(/not encrypted|unknown format/i);
  });

  it("writes the current version and derives its key with HKDF", () => {
    const enc = encryptSecret("token");
    expect(enc.startsWith("v2:")).toBe(true);

    // Pin the derivation: a value encrypted under the OLD SHA-256 key must not
    // decrypt as v2 — otherwise the KDF change silently did nothing.
    const [, ivB64, tagB64, ctB64] = enc.split(":");
    const legacyKey = crypto
      .createHash("sha256")
      .update(process.env.TOKEN_ENC_KEY!)
      .digest();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      legacyKey,
      Buffer.from(ivB64, "base64"),
      { authTagLength: 16 },
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    expect(() =>
      Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]),
    ).toThrow();
  });

  // The weak v1 derivation is no longer reachable from the running app — rows
  // are converted up-front by scripts/migrate-token-encryption.ts.
  it("refuses a legacy v1 value and points at the migration", () => {
    expect(() => decryptSecret(makeV1("legacy-spotify-token"))).toThrow(
      /migrate:tokens/,
    );
  });

  // Error case: tampered ciphertext fails the GCM auth check
  it("throws when the ciphertext has been tampered with", () => {
    const enc = encryptSecret("sensitive");
    const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "B" : "A");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  // Error case: a truncated or oversized GCM auth tag is rejected outright.
  // Node would happily accept a short tag, which makes forging a valid-looking
  // value far cheaper, so decryptSecret enforces the full 16 bytes itself.
  it("throws when the auth tag is not exactly 16 bytes", () => {
    const [prefix, ivB64, tagB64, ctB64] = encryptSecret("sensitive").split(":");
    const tag = Buffer.from(tagB64, "base64");
    expect(tag.length).toBe(16); // sanity: encryptSecret emits a full tag

    const truncated = [prefix, ivB64, tag.subarray(0, 8).toString("base64"), ctB64].join(":");
    expect(() => decryptSecret(truncated)).toThrow(/authentication tag length/);

    const oversized = [
      prefix,
      ivB64,
      Buffer.concat([tag, Buffer.alloc(4)]).toString("base64"),
      ctB64,
    ].join(":");
    expect(() => decryptSecret(oversized)).toThrow(/authentication tag length/);
  });

  // Error case: refuses to encrypt without a key
  it("throws when TOKEN_ENC_KEY is missing", () => {
    const saved = process.env.TOKEN_ENC_KEY;
    delete process.env.TOKEN_ENC_KEY;
    try {
      expect(() => encryptSecret("x")).toThrow(/TOKEN_ENC_KEY/);
    } finally {
      process.env.TOKEN_ENC_KEY = saved;
    }
  });
});
