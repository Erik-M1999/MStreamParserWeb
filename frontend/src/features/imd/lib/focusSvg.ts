import DOMPurify from "dompurify";

// Client-only. PREVIEW ONLY: reframes an SVG so its artwork fills the viewport,
// like Affinity's "Selection Area" export. The templates declare a big viewBox
// (e.g. 0 0 10000 10000) but only use part of it, so the raw preview looks tiny.
// Downloads/exports always use the FULL original document, not this cropped view.
// Falls back to the sanitized document as-is if content bounds can't be found.
//
// SECURITY: templates are arbitrary user-supplied files (uploaded, or dropped in
// from anywhere on the internet), and SvgTagEditor renders this function's output
// through dangerouslySetInnerHTML. That means the result is re-parsed by the
// browser's *lenient HTML* parser, which happily executes things the strict XML
// parser rejected. So every path out of here must return sanitized markup —
// returning the input untouched on a parse failure was exactly the hole that
// allowed `<img src=x onerror=...>` in a malformed template to run.

/** Strips anything executable. The single choke point for untrusted SVG. */
export function sanitizeSvg(svgString: string): string {
  if (typeof window === "undefined") return "";
  return DOMPurify.sanitize(svgString, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}

export function focusSvgToContent(svgString: string, paddingRatio = 0.04): string {
  // No DOM (SSR/prerender): we cannot sanitize, so emit nothing rather than
  // passing untrusted markup through. The preview is client-rendered anyway.
  if (typeof window === "undefined") return "";

  const safe = sanitizeSvg(svgString);

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(safe, "image/svg+xml");
  } catch {
    return safe;
  }

  const svg = doc.documentElement;
  if (
    !svg ||
    svg.nodeName.toLowerCase() !== "svg" ||
    doc.getElementsByTagName("parsererror").length > 0
  ) {
    return safe;
  }

  const probe = document.importNode(svg, true) as unknown as SVGSVGElement;
  const holder = document.createElement("div");
  holder.setAttribute(
    "style",
    "position:absolute;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden;opacity:0;",
  );
  holder.appendChild(probe);
  document.body.appendChild(holder);

  let box: DOMRect | null = null;
  try {
    box = probe.getBBox();
  } catch {
    box = null;
  } finally {
    document.body.removeChild(holder);
  }

  if (!box || box.width <= 0 || box.height <= 0) return safe;

  const pad = Math.max(box.width, box.height) * paddingRatio;
  svg.setAttribute(
    "viewBox",
    `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`,
  );
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");

  return new XMLSerializer().serializeToString(svg);
}

/** Reads the full document's size from viewBox (preferred) or width/height. */
export function getSvgDimensions(svgString: string): {
  width: number;
  height: number;
} {
  const vb = svgString.match(/viewBox\s*=\s*"([\d.\-\s,]+)"/i);
  if (vb) {
    const parts = vb[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const w = svgString.match(/\bwidth\s*=\s*"([\d.]+)/i);
  const h = svgString.match(/\bheight\s*=\s*"([\d.]+)/i);
  if (w && h && Number(w[1]) > 0 && Number(h[1]) > 0) {
    return { width: Number(w[1]), height: Number(h[1]) };
  }
  return { width: 1000, height: 1000 };
}

