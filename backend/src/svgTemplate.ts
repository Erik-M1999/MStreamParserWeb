import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

// ---------------------------------------------------------------------------
// Fills an SVG "current song" template with live track data.
//
// Two template conventions are supported (both appear in sample-templates/):
//   1. Classic:   element carries  template-id="artist|title|cover"
//   2. Affinity:  a wrapping group carries  id="artist|title|cover"
//                 (Affinity Designer strips custom attributes)
//
// Text slots (artist, title) -> the text content of the inner <text>/<tspan>
//   is fully replaced (handles titles split across multiple <tspan>s).
// Image slot (cover) -> the placeholder <rect> is swapped for an <image>
//   that reuses the rect's position/size.
// ---------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

export interface TemplateFill {
  /** slot name -> text value */
  text: Record<string, string>;
  /** slot name -> image data URI (null entries are skipped) */
  images: Record<string, string | null>;
}

// DOM nodes from xmldom are loosely typed here; we only use a small,
// well-known subset of the DOM API (childNodes, getAttribute, replaceChild…).
type AnyNode = any;

function tagOf(el: AnyNode): string {
  return (el.localName || el.tagName || "").toLowerCase();
}

/** Depth-first search for the first descendant element matching `predicate`. */
function findElement(
  node: AnyNode,
  predicate: (el: AnyNode) => boolean,
): AnyNode | null {
  const children = node.childNodes;
  if (!children) return null;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType !== 1) continue; // element nodes only
    if (predicate(child)) return child;
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

/** Locate a slot by `template-id="name"` (classic) or `id="name"` (Affinity). */
function findSlot(doc: AnyNode, name: string): AnyNode | null {
  return findElement(
    doc,
    (el) =>
      el.getAttribute("template-id") === name || el.getAttribute("id") === name,
  );
}

// ---------------------------------------------------------------------------
// SVG sanitizing (defense-in-depth behind the CSP in shared/svgResponse.ts —
// neither layer is trusted on its own).
//
// SVG can carry script in more places than a <script> tag: <foreignObject> can
// embed arbitrary HTML (<iframe src="javascript:...">), and the animation
// elements can rewrite another element's href or on* handler at runtime. So we
// drop those element types outright and vet every URL-bearing attribute by
// scheme, rather than pattern-matching for "javascript:".
// ---------------------------------------------------------------------------

/** Element types removed wholesale — none has a legitimate use in a template. */
const REMOVED_TAGS = new Set([
  "script",
  "foreignobject", // escape hatch into full HTML
  "iframe",
  "object",
  "embed",
  "handler", // SVG 1.2 event handler element
]);

/** Animation elements: dangerous only when they retarget href / an on* handler. */
const ANIMATION_TAGS = new Set([
  "animate",
  "set",
  "animatetransform",
  "animatemotion",
  "animatecolor",
]);

/**
 * True for URL schemes that can execute or smuggle markup. Relative URLs and
 * fragments (`#slot`) are fine, as are http(s) and `data:` *images* — the cover
 * art we inline is exactly that (and is added after sanitizing, so it is never
 * subject to this check anyway).
 */
function isDangerousUrl(value: string): boolean {
  // Strip whitespace/control chars first: "java\nscript:" is one bypass trick.
  const v = value.replace(/[\s\u0000-\u001F]/g, "").toLowerCase();
  if (!/^[a-z][a-z0-9+.-]*:/.test(v)) return false; // relative or fragment
  if (v.startsWith("https:") || v.startsWith("http:")) return false;
  if (v.startsWith("data:image/")) return false;
  return true; // javascript:, data:text/html, blob:, file:, …
}

const isHrefAttr = (name: string) => /(^|:)href$/i.test(name);

function stripActiveAttributes(el: AnyNode): void {
  const attrs = el.attributes;
  // Walk backwards: removing an attribute shifts the ones after it.
  for (let a = attrs ? attrs.length - 1 : -1; a >= 0; a--) {
    const attr = attrs[a];
    const attrName: string = attr.name ?? "";
    const isHandler = attrName.toLowerCase().startsWith("on");
    const isBadUrl = isHrefAttr(attrName) && isDangerousUrl(attr.value ?? "");
    if (isHandler || isBadUrl) el.removeAttribute(attrName);
  }
}

/** True if an animation element would write to href or an on* handler. */
function retargetsActiveAttribute(el: AnyNode): boolean {
  const target = (el.getAttribute("attributeName") ?? "").trim().toLowerCase();
  return target.startsWith("on") || isHrefAttr(target);
}

function stripActiveContent(el: AnyNode): void {
  stripActiveAttributes(el); // the element itself, not just its descendants
  const children = el.childNodes;
  if (!children) return;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child.nodeType !== 1) continue; // element nodes only
    const tag = tagOf(child);
    if (REMOVED_TAGS.has(tag) || (ANIMATION_TAGS.has(tag) && retargetsActiveAttribute(child))) {
      el.removeChild(child);
      continue;
    }
    stripActiveContent(child);
  }
}

function fillText(doc: AnyNode, name: string, value: string): boolean {
  const slot = findSlot(doc, name);
  if (!slot) return false;

  const tag = tagOf(slot);
  const target =
    tag === "text" || tag === "tspan"
      ? slot
      : findElement(slot, (el) => tagOf(el) === "text");
  if (!target) return false;

  while (target.firstChild) target.removeChild(target.firstChild);
  target.appendChild(doc.createTextNode(value)); // serializer XML-escapes this
  return true;
}

function fillImage(doc: AnyNode, name: string, dataUri: string): boolean {
  const slot = findSlot(doc, name);
  if (!slot) return false;

  const rect =
    tagOf(slot) === "rect" ? slot : findElement(slot, (el) => tagOf(el) === "rect");
  if (!rect || !rect.parentNode) return false;

  const image = doc.createElementNS(SVG_NS, "image");
  for (const attr of ["x", "y", "width", "height"]) {
    const v = rect.getAttribute(attr);
    if (v != null) image.setAttribute(attr, v);
  }
  image.setAttribute("href", dataUri); // SVG 2
  image.setAttribute("xlink:href", dataUri); // SVG 1.1 viewers
  image.setAttribute("preserveAspectRatio", "xMidYMid slice");
  const tid = rect.getAttribute("template-id");
  if (tid) image.setAttribute("template-id", tid);

  rect.parentNode.replaceChild(image, rect);
  return true;
}

export function fillTemplate(svg: string, fill: TemplateFill): string {
  const problems: string[] = [];
  const doc = new DOMParser({
    onError: (level, msg) => {
      if (level === "error" || level === "fatalError") problems.push(msg);
    },
  }).parseFromString(svg, "image/svg+xml");

  const root = doc.documentElement;
  if (!root || tagOf(root) !== "svg") {
    throw new Error(
      "Uploaded file is not a valid SVG." +
        (problems.length ? ` (${problems[0]})` : ""),
    );
  }

  stripActiveContent(root);

  let filled = 0;
  for (const [slot, value] of Object.entries(fill.text)) {
    if (fillText(doc, slot, value)) filled++;
  }
  for (const [slot, uri] of Object.entries(fill.images)) {
    if (uri && fillImage(doc, slot, uri)) filled++;
  }

  if (filled === 0) {
    throw new Error(
      "No fillable slots found for this mode. Check the template's tags.",
    );
  }

  return new XMLSerializer().serializeToString(doc);
}
