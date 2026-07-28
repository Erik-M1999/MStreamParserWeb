import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import bcrypt from "bcrypt";

vi.mock("../src/db", () => ({
  prisma: {
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
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
import { register, login } from "../src/modules/auth/auth.service";

const user = prisma.user as unknown as { findFirst: Mock; findUnique: Mock; create: Mock };
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
});
