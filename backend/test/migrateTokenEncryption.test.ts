import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { decryptSecret, encryptSecret } from "../src/crypto";
import { upgradeValue } from "../src/scripts/migrate-token-encryption";

// The migration is what lets us drop v1 support from the running app, so its
// core conversion needs to be pinned even though the script itself is a one-off.

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

describe("migrate-token-encryption: upgradeValue", () => {
  it("converts a v1 value to v2 without changing the plaintext", () => {
    const plain = "BQABCD-spotify-refresh-token";
    const v1 = makeV1(plain);

    // Precondition: the app itself can no longer read this.
    expect(() => decryptSecret(v1)).toThrow();

    const v2 = upgradeValue(v1)!;
    expect(v2.startsWith("v2:")).toBe(true);
    expect(decryptSecret(v2)).toBe(plain); // same secret, new format
  });

  it("returns null for a value that is already v2 (so the row is skipped)", () => {
    expect(upgradeValue(encryptSecret("already-current"))).toBeNull();
  });

  it("is idempotent — re-running leaves converted rows alone", () => {
    const v2 = upgradeValue(makeV1("token"))!;
    expect(upgradeValue(v2)).toBeNull();
  });

  it("throws on plaintext or an unknown format rather than guessing", () => {
    expect(() => upgradeValue("plain-token")).toThrow(/Unrecognised/i);
    expect(() => upgradeValue("v9:a:b:c")).toThrow(/Unrecognised/i);
  });

  it("throws on a v1 value with a truncated auth tag", () => {
    const [, iv, tag, ct] = makeV1("token").split(":");
    const truncated = [
      "v1",
      iv,
      Buffer.from(tag, "base64").subarray(0, 8).toString("base64"),
      ct,
    ].join(":");
    expect(() => upgradeValue(truncated)).toThrow(/authentication tag length/);
  });
});
