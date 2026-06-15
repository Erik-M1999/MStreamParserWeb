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

export interface CurrentSongFill {
  artist: string;
  title: string;
  coverDataUri: string | null;
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

export function fillCurrentSongTemplate(
  svg: string,
  fill: CurrentSongFill,
): string {
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

  const filled: string[] = [];
  if (fillText(doc, "artist", fill.artist)) filled.push("artist");
  if (fillText(doc, "title", fill.title)) filled.push("title");
  if (fill.coverDataUri && fillImage(doc, "cover", fill.coverDataUri)) {
    filled.push("cover");
  }

  if (filled.length === 0) {
    throw new Error(
      "No fillable slots found. Expected template-id (or id) of 'artist', 'title', or 'cover'.",
    );
  }

  return new XMLSerializer().serializeToString(doc);
}
