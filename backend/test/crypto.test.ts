import { describe, it, expect, beforeAll } from "vitest";
import { encryptSecret, decryptSecret } from "../src/crypto";

// Unit tests for the at-rest encryption helpers (pure logic — no DB/network).
// crypto.key() reads TOKEN_ENC_KEY at call time, so setting it here is enough.

beforeAll(() => {
  process.env.TOKEN_ENC_KEY = "test-key-for-unit-tests";
});

describe("encryptSecret / decryptSecret", () => {
  // Normal case
  it("round-trips a value back to the original plaintext", () => {
    const plain = "BQABCD-spotify-access-token";
    const enc = encryptSecret(plain);
    expect(enc).not.toBe(plain);
    expect(enc.startsWith("v1:")).toBe(true);
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

  // Edge case: legacy plaintext (no "v1:" prefix) passes straight through
  it("returns legacy plaintext unchanged when there is no v1: prefix", () => {
    expect(decryptSecret("legacy-plaintext-token")).toBe("legacy-plaintext-token");
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
