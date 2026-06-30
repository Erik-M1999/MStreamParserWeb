import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";

// ---------------------------------------------------------------------------
// Auth middleware: verifies the login JWT (carried in the HttpOnly cookie) and
// attaches the payload to req.user. `authenticate` rejects with 401 when the
// token is missing/invalid; `optionalUser` returns the user or null (no error),
// for routes that behave differently for anonymous vs. logged-in callers.
//
// JWT_SECRET / COOKIE_NAME live here (the verification side) and are re-used by
// routes/auth.ts (the signing/cookie-setting side) so both stay in sync.
// ---------------------------------------------------------------------------

export const JWT_SECRET = process.env.JWT_SECRET ?? "";
export const COOKIE_NAME = "imd_token";

export interface JwtPayload {
  userId: number;
  email: string;
  username: string;
}

export interface AuthedRequest extends Request {
  user?: JwtPayload;
}

export function configured(): boolean {
  return JWT_SECRET.length > 0;
}

/** Reads our JWT from the request's Cookie header (no cookie-parser needed). */
export function readToken(req: Request): string | null {
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

/** Returns the user if a valid auth cookie is present, else null (no error). */
export function optionalUser(req: Request): JwtPayload | null {
  const token = readToken(req);
  if (!token || !configured()) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

/** Middleware for protected routes: 401 unless a valid JWT is present. */
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
