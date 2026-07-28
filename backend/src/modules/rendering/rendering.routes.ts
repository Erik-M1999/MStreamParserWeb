import { Router, type Request } from "express";
import { authenticate, type AuthedRequest } from "../../middleware/authenticate.js";
import { rateLimit } from "../../shared/rateLimit.js";
import { route } from "../../shared/route.js";
import { sendSvg } from "../../shared/svgResponse.js";
import { render } from "./rendering.service.js";

// ---------------------------------------------------------------------------
// ImmersiveMusicDisplay render endpoint (thin). Takes an uploaded SVG template
// (raw body) + a mode, fills it with the user's Spotify data, returns the SVG.
// Modes: current-song, queue, playlist. Logic lives in rendering.service.ts.
// ---------------------------------------------------------------------------

const router = Router();
const userIdOf = (req: Request) => (req as AuthedRequest).user!.userId;

// Rendering parses an uploaded SVG and fans out to Spotify + cover-art CDNs, so
// it is far more expensive than a normal request. 60/minute per IP is well above
// any interactive use of the tool but caps what a loop can cost us.
const renderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: "Too many render requests. Please slow down.",
});

router.post(
  "/immersive/render",
  renderLimiter,
  authenticate,
  route(async (req, res) => {
    const svg = typeof req.body === "string" ? req.body : "";
    const mode = typeof req.query.mode === "string" ? req.query.mode : "current-song";
    const filled = await render(userIdOf(req), svg, mode);
    sendSvg(res, filled);
  }),
);

export default router;
