import { type Request, type Response, type NextFunction } from "express";
import { type AuthedRequest } from "../../middleware/authenticate.js";
import { verifyKey } from "./apikeys.service.js";

// Auth middleware for the external API (/api/v1/*). Machines can't send our
// HttpOnly cookie, so they present an API key as `Authorization: Bearer msp_…`
// (or `X-API-Key`). On success it sets req.user just like `authenticate`, so
// downstream handlers and services read req.user.userId identically.

function extractKey(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const x = req.headers["x-api-key"];
  if (typeof x === "string" && x.trim()) return x.trim();
  return null;
}

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const key = extractKey(req);
  if (!key) {
    res.status(401).json({ error: "Missing API key." });
    return;
  }
  const user = await verifyKey(key);
  if (!user) {
    res.status(401).json({ error: "Invalid API key." });
    return;
  }
  (req as AuthedRequest).user = user;
  next();
}
