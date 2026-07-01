import { Router, type Request, type Response } from "express";
import { type AuthedRequest } from "../../middleware/authenticate.js";
import { route } from "../../shared/route.js";
import { apiKeyAuth } from "../apikeys/apiKeyAuth.js";
import * as library from "../library/library.service.js";
import { render, svgToPng } from "../rendering/rendering.service.js";

// ---------------------------------------------------------------------------
// External / public API for tools (e.g. 3Ds Max), under /api/v1. Authenticated
// by API key (apiKeyAuth, per-route). Reuses the Library service — no new
// business logic. Later: GET /v1/render/:id (filled SVG/PNG).
// ---------------------------------------------------------------------------

const router = Router();

const userIdOf = (req: Request) => (req as AuthedRequest).user!.userId;
const idParam = (req: Request) =>
  Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);

// Connectivity check: returns who the key belongs to.
router.get("/v1/whoami", apiKeyAuth, (req: Request, res: Response) => {
  const user = (req as AuthedRequest).user!;
  res.json({ userId: user.userId, username: user.username });
});

// List the key-owner's templates (id, folder path, name, mode) — for selection.
// ?format=text returns tab-separated lines (id<TAB>path/name<TAB>mode) — easy
// for MaxScript to parse and show the folder hierarchy; default is JSON.
router.get(
  "/v1/templates",
  apiKeyAuth,
  route(async (req, res) => {
    const list = await library.listTemplatesWithPath(userIdOf(req));
    if (req.query.format === "text") {
      const text = list
        .map((t) => {
          const label = (t.path ? `${t.path}/${t.name}` : t.name).replace(/[\t\r\n]+/g, " ");
          return `${t.id}\t${label}\t${t.mode}`;
        })
        .join("\n");
      res.type("text/plain").send(text);
    } else {
      res.json(list);
    }
  }),
);

// Fetch one template's raw SVG (404 if it isn't the key-owner's).
router.get(
  "/v1/templates/:id",
  apiKeyAuth,
  route(async (req, res) => {
    const t = await library.getTemplate(userIdOf(req), idParam(req));
    res.type("image/svg+xml").send(t.svg);
  }),
);

// Render a stored template with the key-owner's live Spotify data.
// `mode` defaults to the template's own saved mode (override with ?mode=).
// `?format=png` rasterizes server-side; `?size=` sets the LONGEST side in px
// (capped at the template's natural size — never upscales). Default is SVG.
router.get(
  "/v1/render/:id",
  apiKeyAuth,
  route(async (req, res) => {
    const userId = userIdOf(req);
    const t = await library.getTemplate(userId, idParam(req)); // 404 if not owned
    const mode = typeof req.query.mode === "string" ? req.query.mode : t.mode;
    const svg = await render(userId, t.svg, mode);

    if (req.query.format === "png") {
      const size = typeof req.query.size === "string" ? Number(req.query.size) : undefined;
      res.type("image/png").send(svgToPng(svg, size));
    } else {
      res.type("image/svg+xml").send(svg);
    }
  }),
);

export default router;
