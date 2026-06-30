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
