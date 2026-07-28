import { Router, type Request, type Response } from "express";
import { COOKIE_NAME, optionalUser } from "../../middleware/authenticate.js";
import { rateLimit } from "../../shared/rateLimit.js";
import { route } from "../../shared/route.js";
import { register, login, TOKEN_TTL_SECONDS } from "./auth.service.js";

// Auth routes (thin). HTTP concerns only: cookie set/clear, rate limiting, and
// reading the request. All credential logic lives in auth.service.ts.

const router = Router();

// Mark the cookie Secure whenever the request actually arrived over HTTPS
// (req.secure honours the proxy's X-Forwarded-Proto — see `trust proxy` in
// server.ts), and always in production. Keying off the connection rather than
// NODE_ENV alone means a non-production HTTPS deployment still gets a Secure
// cookie, while plain-http local dev keeps working.
function useSecureCookie(req: Request): boolean {
  return req.secure || process.env.NODE_ENV === "production";
}

function setAuthCookie(req: Request, res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookie(req),
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: "/",
  });
}

function clearAuthCookie(req: Request, res: Response) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookie(req),
    path: "/",
  });
}

// 10 attempts per 15 minutes per IP on the auth entry points (brute-force brake).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many attempts. Please try again later.",
});

router.post(
  "/auth/register",
  authLimiter,
  route(async (req, res) => {
    res.status(201).json(await register((req.body ?? {}) as Record<string, unknown>));
  }),
);

router.post(
  "/auth/login",
  authLimiter,
  route(async (req, res) => {
    const { token, user } = await login((req.body ?? {}) as Record<string, unknown>);
    setAuthCookie(req, res, token);
    res.json(user);
  }),
);

router.post("/auth/logout", (req: Request, res: Response) => {
  clearAuthCookie(req, res);
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
