import bcrypt from "bcrypt";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../db.js";
import { sendWelcomeEmail } from "../../mail.js";
import { HttpError } from "../../shared/errors.js";
import { JWT_SECRET, configured, type JwtPayload } from "../../middleware/authenticate.js";

// ---------------------------------------------------------------------------
// Auth context logic: register + login. Passwords are bcrypt-hashed; login
// mints a JWT. The HTTP side (cookie set/clear, rate limiting) lives in
// auth.routes.ts; the JWT *verifying* side lives in middleware/authenticate.ts.
//
// Public:   register, login, TOKEN_TTL_SECONDS
// ---------------------------------------------------------------------------

export const TOKEN_TTL_SECONDS = 60 * 60 * 24; // 24h

const BCRYPT_COST = 12;

type Body = Record<string, unknown>;

// A real bcrypt hash of a throwaway value, used to burn the same ~190ms on a
// failed lookup as on a wrong password (see login). Built on first use rather
// than at import so the cost lands on a login attempt, not on every process
// start (including every test file that imports this module).
let dummyHash: string | undefined;
async function dummyPasswordHash(): Promise<string> {
  dummyHash ??= await bcrypt.hash(crypto.randomBytes(16).toString("hex"), BCRYPT_COST);
  return dummyHash;
}

export async function register(body: Body): Promise<{ id: number; username: string }> {
  if (!configured()) throw new HttpError(500, "Auth is not configured (set JWT_SECRET).");
  const { email, username, password } = body;
  if (
    typeof email !== "string" ||
    typeof username !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !username.trim()
  ) {
    throw new HttpError(400, "Email, username and password are required.");
  }
  if (password.length < 8) {
    throw new HttpError(400, "Password must be at least 8 characters.");
  }

  const emailN = email.trim().toLowerCase();
  // Deliberately permissive: the goal is to catch obvious typos and junk, not to
  // implement RFC 5322. Anything stricter rejects addresses that really exist.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailN)) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  const usernameN = username.trim();
  const exists = await prisma.user.findFirst({
    where: { OR: [{ email: emailN }, { username: usernameN }] },
  });
  if (exists) throw new HttpError(409, "Email or username is already taken.");

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const user = await prisma.user.create({
    data: { email: emailN, username: usernameN, passwordHash },
  });
  // Fire-and-forget: the (slow, external) mail send never blocks/fails register.
  // sendWelcomeEmail already swallows its own errors; the .catch() is a belt so
  // a future change there can't turn register into an unhandled rejection (which
  // Node treats as fatal) and hand anyone a way to crash the process.
  void sendWelcomeEmail(emailN, usernameN).catch((err: unknown) => {
    console.error("[auth] welcome email failed:", err);
  });
  return { id: user.id, username: user.username };
}

export async function login(
  body: Body,
): Promise<{ token: string; user: { id: number; username: string; email: string } }> {
  if (!configured()) throw new HttpError(500, "Auth is not configured (set JWT_SECRET).");
  const { username, password } = body;
  if (typeof username !== "string" || typeof password !== "string") {
    throw new HttpError(400, "Username and password are required.");
  }
  // Identical message AND identical timing whether the username or the password
  // is wrong. Short-circuiting on a missing user would skip bcrypt entirely and
  // answer in ~0ms instead of ~190ms, which is a trivially measurable oracle for
  // "does this username exist?" — so an unknown user is compared against a
  // throwaway hash and the result is discarded.
  const user = await prisma.user.findUnique({ where: { username: username.trim() } });
  const hashToCompare = user ? user.passwordHash : await dummyPasswordHash();
  const passwordMatches = await bcrypt.compare(password, hashToCompare);
  if (!user || !passwordMatches) {
    throw new HttpError(401, "Username or password is invalid.");
  }
  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    username: user.username,
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
  return { token, user: { id: user.id, username: user.username, email: user.email } };
}

/** Permanently deletes the account after re-confirming the password. Cascades
 *  to the user's folders, templates, connections and API keys (Prisma
 *  onDelete: Cascade). */
export async function deleteAccount(userId: number, password: unknown): Promise<void> {
  if (typeof password !== "string" || !password) {
    throw new HttpError(400, "Password is required.");
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, "Password is incorrect.");
  }
  await prisma.user.delete({ where: { id: userId } });
}
