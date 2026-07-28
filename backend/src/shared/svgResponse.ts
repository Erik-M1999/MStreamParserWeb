import { type Response } from "express";

// ---------------------------------------------------------------------------
// Single place that sends an SVG body.
//
// SVG is an active document: a browser opening one top-level (not via <img>)
// will run <script> and on* handlers inside it. Our templates are user-uploaded
// and served back under the same origin, so a strict Content-Security-Policy is
// the cheap, dependency-free containment layer — even if a template smuggles a
// script past svgTemplate's sanitizer, the CSP gives it nothing to do:
//   default-src 'none'   -> no scripts, no fetch/XHR, no frames, no exfil
//   style-src  'unsafe-inline' -> inline <style>/style="" still render (SVGs need it)
//   img-src    'self' data:    -> embedded cover art (data: URIs) still render
// nosniff keeps a browser from re-interpreting the response as HTML.
// ---------------------------------------------------------------------------

export const SVG_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:";

/** Sends `svg` as image/svg+xml with the hardened headers applied. */
export function sendSvg(res: Response, svg: string): void {
  res.setHeader("Content-Security-Policy", SVG_CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.type("image/svg+xml").send(svg);
}
