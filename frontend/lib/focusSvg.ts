// Client-only. Reframes an SVG so its actual artwork fills the viewport,
// like Affinity's "Selection Area" export. The templates declare a big
// viewBox (e.g. 0 0 10000 10000) but only use part of it, so the raw preview
// looks tiny. We measure the real content bounds with getBBox() and set the
// viewBox to them. Returns the original string if bounds can't be determined.

export function focusSvgToContent(svgString: string, paddingRatio = 0.04): string {
  if (typeof window === "undefined") return svgString;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
  } catch {
    return svgString;
  }

  const svg = doc.documentElement;
  if (
    !svg ||
    svg.nodeName.toLowerCase() !== "svg" ||
    doc.getElementsByTagName("parsererror").length > 0
  ) {
    return svgString;
  }

  // Defensive: drop scripts and inline event handlers before attaching to the
  // live DOM (the only step where an SVG could otherwise execute code).
  stripActiveContent(svg);

  // Attach an off-screen copy just long enough to measure it.
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

  if (!box || box.width <= 0 || box.height <= 0) return svgString;

  const pad = Math.max(box.width, box.height) * paddingRatio;
  const x = box.x - pad;
  const y = box.y - pad;
  const w = box.width + pad * 2;
  const h = box.height + pad * 2;

  svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");

  return new XMLSerializer().serializeToString(svg);
}

function stripActiveContent(root: Element) {
  for (const script of Array.from(root.getElementsByTagName("script"))) {
    script.remove();
  }
  const walk = (node: Element) => {
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.toLowerCase().startsWith("on")) node.removeAttribute(attr.name);
    }
    for (const child of Array.from(node.children)) walk(child);
  };
  walk(root);
}
