import { Router, type Request } from "express";
import { authenticate, type AuthedRequest } from "../../middleware/authenticate.js";
import { route } from "../../shared/route.js";
import { render } from "./rendering.service.js";

// ---------------------------------------------------------------------------
// ImmersiveMusicDisplay render endpoint (thin). Takes an uploaded SVG template
// (raw body) + a mode, fills it with the user's Spotify data, returns the SVG.
// Modes: current-song, queue, playlist. Logic lives in rendering.service.ts.
// ---------------------------------------------------------------------------

const router = Router();
const userIdOf = (req: Request) => (req as AuthedRequest).user!.userId;

router.post(
  "/immersive/render",
  authenticate,
  route(async (req, res) => {
    const svg = typeof req.body === "string" ? req.body : "";
    const mode = typeof req.query.mode === "string" ? req.query.mode : "current-song";
    const filled = await render(userIdOf(req), svg, mode);
    res.type("image/svg+xml").send(filled);
  }),
);

export default router;
