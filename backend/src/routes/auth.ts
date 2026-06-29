import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";

// ---------------------------------------------------------------------------
// Auth: register / login / logout / me. Passwords are bcrypt-hashed; login
// issues a JWT stored as an HttpOnly cookie. Login is by username + password;
// the failure message is identical for wrong-user vs wrong-password.
// ---------------------------------------------------------------------------

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? "";
const COOKIE_NAME = "imd_token";
const TOKEN_TTL_SECONDS = 60 * 60 * 24; // 24h

export interface JwtPayload {
  userId: number;
  email: string;
  username: string;
}

export interface AuthedRequest extends Request {
  user?: JwtPayload;
}

function configured(): boolean {
  return JWT_SECRET.length > 0;
}

function setAuthCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: "/",
  });
}

function clearAuthCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

/** Reads our JWT from the request's Cookie header (no cookie-parser needed). */
function readToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

router.post("/auth/register", async (req: Request, res: Response) => {
  if (!configured()) {
    res.status(500).json({ error: "Auth is not configured (set JWT_SECRET)." });
    return;
  }
  const { email, username, password } = (req.body ?? {}) as {
    email?: unknown;
    username?: unknown;
    password?: unknown;
  };
  if (
    typeof email !== "string" ||
    typeof username !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !username.trim()
  ) {
    res.status(400).json({ error: "Email, username and password are required." });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  const emailN = email.trim().toLowerCase();
  const usernameN = username.trim();
  try {
    const exists = await prisma.user.findFirst({
      where: { OR: [{ email: emailN }, { username: usernameN }] },
    });
    if (exists) {
      res.status(409).json({ error: "Email or username is already taken." });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email: emailN, username: usernameN, passwordHash },
    });
    res.status(201).json({ id: user.id, username: user.username });
  } catch (err) {
    console.error("[auth] register error:", err);
    res.status(500).json({ error: "Could not create the account." });
  }
});

router.post("/auth/login", async (req: Request, res: Response) => {
  if (!configured()) {
    res.status(500).json({ error: "Auth is not configured (set JWT_SECRET)." });
    return;
  }
  const { username, password } = (req.body ?? {}) as {
    username?: unknown;
    password?: unknown;
  };
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }
  // Identical message whether the username or the password is wrong.
  const INVALID = "Username or password is invalid.";
  try {
    const user = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: INVALID });
      return;
    }
    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      username: user.username,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
    setAuthCookie(res, token);
    res.json({ id: user.id, username: user.username, email: user.email });
  } catch (err) {
    console.error("[auth] login error:", err);
    res.status(500).json({ error: "Login failed." });
  }
});

router.post("/auth/logout", (_req: Request, res: Response) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get("/auth/me", (req: Request, res: Response) => {
  const token = readToken(req);
  if (!token || !configured()) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    res.json({ id: payload.userId, username: payload.username, email: payload.email });
  } catch {
    res.status(401).json({ error: "Not authenticated." });
  }
});

/** Middleware for protected routes (used as ownership/auth is added). */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token || !configured()) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  try {
    (req as AuthedRequest).user = jwt.verify(token, JWT_SECRET) as JwtPayload;
    next();
  } catch {
    res.status(401).json({ error: "Not authenticated." });
  }
}

export default router;
