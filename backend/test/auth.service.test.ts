import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import bcrypt from "bcrypt";

vi.mock("../src/db", () => ({
  prisma: {
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
  },
}));
// Fire-and-forget welcome email — stub so register never touches Resend.
// Resolves like the real one: register attaches a .catch() to the returned
// promise, so a mock returning undefined would not match the real signature.
vi.mock("../src/mail", () => ({
  sendWelcomeEmail: vi.fn(async () => {}),
}));

import { prisma } from "../src/db";
import { sendWelcomeEmail } from "../src/mail";
import { register, login, deleteAccount } from "../src/modules/auth/auth.service";

const user = prisma.user as unknown as {
  findFirst: Mock;
  findUnique: Mock;
  create: Mock;
  delete: Mock;
};
const mailMock = sendWelcomeEmail as unknown as Mock;

const validBody = { email: "New@Example.com ", username: " erik ", password: "password123" };

beforeEach(() => {
  vi.clearAllMocks();
  user.findFirst.mockResolvedValue(null);
  user.create.mockResolvedValue({ id: 5, email: "new@example.com", username: "erik" });
});

describe("auth.service register", () => {
  it("rejects missing/blank fields (400)", async () => {
    await expect(register({})).rejects.toMatchObject({ status: 400 });
    await expect(register({ email: " ", username: "u", password: "password123" })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a password shorter than 8 chars (400)", async () => {
    await expect(register({ email: "a@b.co", username: "u", password: "short" })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a malformed email address (400)", async () => {
    for (const email of ["notanemail", "no@domain", "@example.com", "a b@example.com", "a@b."]) {
      await expect(
        register({ email, username: "u", password: "password123" }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(user.create).not.toHaveBeenCalled();
  });

  it("accepts ordinary real-world addresses", async () => {
    for (const email of [
      "erik@m1999.de",
      "first.last+tag@sub.example.co.uk",
      "u_1-2@example-host.com",
    ]) {
      user.create.mockResolvedValueOnce({ id: 5, email, username: "u" });
      await expect(
        register({ email, username: "u", password: "password123" }),
      ).resolves.toBeDefined();
    }
  });

  it("rejects a duplicate email/username (409)", async () => {
    user.findFirst.mockResolvedValueOnce({ id: 1 });
    await expect(register(validBody)).rejects.toMatchObject({ status: 409 });
  });

  it("normalizes input, hashes the password, and fires the welcome email", async () => {
    const result = await register(validBody);
    expect(result).toEqual({ id: 5, username: "erik" });

    const createArg = user.create.mock.calls[0][0].data;
    expect(createArg.email).toBe("new@example.com"); // lowercased + trimmed
    expect(createArg.username).toBe("erik"); // trimmed
    expect(createArg.passwordHash).not.toBe("password123"); // hashed
    expect(await bcrypt.compare("password123", createArg.passwordHash)).toBe(true);
    expect(mailMock).toHaveBeenCalledWith("new@example.com", "erik");
  });

  // The mail send is fire-and-forget. If a rejection escaped, Node would treat
  // it as an unhandled rejection and kill the process — i.e. anyone could crash
  // the server by registering while the mail provider is down.
  it("still succeeds when the welcome email rejects", async () => {
    mailMock.mockRejectedValueOnce(new Error("resend is down"));
    const unhandled = vi.fn();
    process.once("unhandledRejection", unhandled);

    await expect(register({ ...validBody })).resolves.toMatchObject({ username: "erik" });

    // Give the rejected promise a turn to surface before asserting.
    await new Promise((r) => setImmediate(r));
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });
});

describe("auth.service login", () => {
  it("rejects missing credentials (400)", async () => {
    await expect(login({})).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an unknown user with 401", async () => {
    user.findUnique.mockResolvedValueOnce(null);
    await expect(login({ username: "ghost", password: "password123" })).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a wrong password with 401", async () => {
    user.findUnique.mockResolvedValueOnce({ id: 1, username: "erik", email: "e@x", passwordHash: await bcrypt.hash("correct-horse", 4) });
    await expect(login({ username: "erik", password: "wrong" })).rejects.toMatchObject({ status: 401 });
  });

  it("returns a signed token and the user on success", async () => {
    user.findUnique.mockResolvedValueOnce({ id: 9, username: "erik", email: "e@x", passwordHash: await bcrypt.hash("password123", 4) });
    const { token, user: u } = await login({ username: "erik", password: "password123" });
    expect(token.split(".")).toHaveLength(3); // JWT
    expect(u).toEqual({ id: 9, username: "erik", email: "e@x" });
  });

  // A missing user must still cost a bcrypt comparison. Without it the reply
  // comes back in ~0ms vs ~190ms for a real user with a wrong password, which
  // is a reliable "does this username exist?" oracle over the network.
  it("spends a bcrypt comparison even when the username does not exist", async () => {
    const compareSpy = vi.spyOn(bcrypt, "compare");

    user.findUnique.mockResolvedValueOnce(null);
    await expect(
      login({ username: "ghost", password: "password123" }),
    ).rejects.toMatchObject({ status: 401 });

    expect(compareSpy).toHaveBeenCalledTimes(1);
    // Compared against a real hash of something else — never the input itself.
    const [submitted, hash] = compareSpy.mock.calls[0];
    expect(submitted).toBe("password123");
    expect(String(hash)).toMatch(/^\$2[aby]\$/); // a valid bcrypt hash
    expect(await bcrypt.compare("password123", String(hash))).toBe(false);

    compareSpy.mockRestore();
  });

  it("measures the same order of magnitude for unknown user and wrong password", async () => {
    const realHash = await bcrypt.hash("correct-horse", 12);

    user.findUnique.mockResolvedValueOnce(null);
    let t = process.hrtime.bigint();
    await login({ username: "ghost", password: "x" }).catch(() => {});
    const unknownUserMs = Number(process.hrtime.bigint() - t) / 1e6;

    user.findUnique.mockResolvedValueOnce({
      id: 1, username: "erik", email: "e@x", passwordHash: realHash,
    });
    t = process.hrtime.bigint();
    await login({ username: "erik", password: "x" }).catch(() => {});
    const wrongPasswordMs = Number(process.hrtime.bigint() - t) / 1e6;

    // Both paths run one cost-12 bcrypt, so neither should be near-instant and
    // the ratio should stay small. Generous bounds: this is wall-clock timing
    // on a shared CI box, not a precision benchmark.
    expect(unknownUserMs).toBeGreaterThan(20);
    const ratio =
      Math.max(unknownUserMs, wrongPasswordMs) / Math.min(unknownUserMs, wrongPasswordMs);
    expect(ratio).toBeLessThan(3);
  });
});

describe("auth.service deleteAccount", () => {
  it("rejects a missing password (400) and never deletes", async () => {
    await expect(deleteAccount(1, "")).rejects.toMatchObject({ status: 400 });
    await expect(deleteAccount(1, undefined)).rejects.toMatchObject({ status: 400 });
    expect(user.delete).not.toHaveBeenCalled();
  });

  it("rejects a wrong password or unknown user with 401 (no delete)", async () => {
    user.findUnique.mockResolvedValueOnce({ id: 1, passwordHash: await bcrypt.hash("right", 4) });
    await expect(deleteAccount(1, "wrong")).rejects.toMatchObject({ status: 401 });

    user.findUnique.mockResolvedValueOnce(null);
    await expect(deleteAccount(1, "whatever")).rejects.toMatchObject({ status: 401 });

    expect(user.delete).not.toHaveBeenCalled();
  });

  it("deletes the account (cascades in the DB) on the correct password", async () => {
    user.findUnique.mockResolvedValueOnce({ id: 9, passwordHash: await bcrypt.hash("password123", 4) });
    user.delete.mockResolvedValueOnce({});
    await expect(deleteAccount(9, "password123")).resolves.toBeUndefined();
    expect(user.delete).toHaveBeenCalledWith({ where: { id: 9 } });
  });
});
