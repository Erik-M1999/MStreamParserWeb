import bcrypt from "bcrypt";
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

type Body = Record<string, unknown>;

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
  const usernameN = username.trim();
  const exists = await prisma.user.findFirst({
    where: { OR: [{ email: emailN }, { username: usernameN }] },
  });
  if (exists) throw new HttpError(409, "Email or username is already taken.");

  const passwordHash = await bcrypt.hash(password, 12);
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
  // Identical message whether the username or the password is wrong.
  const user = await prisma.user.findUnique({ where: { username: username.trim() } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
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
