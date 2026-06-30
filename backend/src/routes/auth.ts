import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";
import {
  JWT_SECRET,
  COOKIE_NAME,
  configured,
  optionalUser,
  type JwtPayload,
} from "../middleware/authenticate.js";

// ---------------------------------------------------------------------------
// Auth: register / login / logout / me. Passwords are bcrypt-hashed; login
// issues a JWT stored as an HttpOnly cookie. Login is by username + password;
// the failure message is identical for wrong-user vs wrong-password.
// (The JWT-verifying side — authenticate/optionalUser — lives in
// middleware/authenticate.ts.)
// ---------------------------------------------------------------------------

const router = Router();
const TOKEN_TTL_SECONDS = 60 * 60 * 24; // 24h

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

// ---------------------------------------------------------------------------
// Tiny in-memory rate limiter (no extra deps). Keyed by client IP per route;
// blocks brute-force on login/register. Fine for a single-process dev/uni
// deployment — swap for a shared store (Redis) if we ever scale horizontally.
// ---------------------------------------------------------------------------
function rateLimit(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > opts.max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "Too many attempts. Please try again later." });
      return;
    }
    next();
  };
}

// 10 attempts per 15 minutes per IP on the auth entry points.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.post("/auth/register", authLimiter, async (req: Request, res: Response) => {
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

router.post("/auth/login", authLimiter, async (req: Request, res: Response) => {
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
  const user = optionalUser(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  res.json({ id: user.userId, username: user.username, email: user.email });
});

export default router;
