import { Router, type Request } from "express";
import { authenticate, type AuthedRequest } from "../../middleware/authenticate.js";
import { route } from "../../shared/route.js";
import * as keys from "./apikeys.service.js";

// Key management for the logged-in user (web UI, cookie auth). Thin handlers.
// `authenticate` is applied PER ROUTE (not router.use) so this router — mounted
// at /api — doesn't accidentally guard unrelated /api paths (e.g. /api/v1/*).

const router = Router();

const userIdOf = (req: Request) => (req as AuthedRequest).user!.userId;
const idParam = (req: Request) =>
  Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);

router.post(
  "/keys",
  authenticate,
  route(async (req, res) => {
    const { name } = (req.body ?? {}) as Record<string, unknown>;
    // The plaintext key is in this response ONLY — shown to the user once.
    res.status(201).json(await keys.createKey(userIdOf(req), name));
  }),
);

router.get(
  "/keys",
  authenticate,
  route(async (req, res) => {
    res.json(await keys.listKeys(userIdOf(req)));
  }),
);

router.delete(
  "/keys/:id",
  authenticate,
  route(async (req, res) => {
    await keys.revokeKey(userIdOf(req), idParam(req));
    res.status(204).end();
  }),
);

export default router;
