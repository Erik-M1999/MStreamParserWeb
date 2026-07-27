import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db";
import * as apikeys from "../src/modules/apikeys/apikeys.service";

// Real-DB tests for the ApiKeys service. Throwaway user, cleaned up after.

const tag = Date.now().toString(36);
let userId: number;

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: `key_${tag}@itest.local`, username: `key_${tag}`, passwordHash: "x" },
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("apikeys service", () => {
  it("rejects a blank key name (400)", async () => {
    await expect(apikeys.createKey(userId, "  ")).rejects.toMatchObject({ status: 400 });
    await expect(apikeys.createKey(userId, 123)).rejects.toMatchObject({ status: 400 });
  });

  it("creates a key (plaintext shown once) and lists it without the hash", async () => {
    const created = await apikeys.createKey(userId, "3ds Max");
    expect(created.key).toMatch(/^msp_/);
    expect(created.name).toBe("3ds Max");

    const list = await apikeys.listKeys(userId);
    const row = list.find((k) => k.id === created.id)!;
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("keyHash");
    expect(row.name).toBe("3ds Max");
  });

  it("verifies a valid key and returns the owning user", async () => {
    const { key } = await apikeys.createKey(userId, "verify-me");
    const who = await apikeys.verifyKey(key);
    expect(who).toMatchObject({ userId, username: `key_${tag}` });
  });

  it("returns null for a wrong prefix or an unknown key", async () => {
    expect(await apikeys.verifyKey("nope_abc")).toBeNull();
    expect(await apikeys.verifyKey("msp_totally-made-up")).toBeNull();
  });

  it("revokes a key (and 404s the second time)", async () => {
    const { id } = await apikeys.createKey(userId, "revoke-me");
    await apikeys.revokeKey(userId, id);
    await expect(apikeys.revokeKey(userId, id)).rejects.toMatchObject({ status: 404 });
  });

  it("won't revoke another user's key", async () => {
    const { id } = await apikeys.createKey(userId, "mine");
    await expect(apikeys.revokeKey(userId + 999999, id)).rejects.toMatchObject({ status: 404 });
    await apikeys.revokeKey(userId, id); // cleanup
  });
});
