// Client-only. Handles overly long TEXT fields (title and artist) in the
// "current song" template. If a field is wider than its window, we clip it to
// the window, translate it by an offset (random pan), and fade the LEFT edge
// with an SVG mask. The RIGHT edge is the user's own gradient.
//
// The window default + left-fade default are derived from the template's hider
// gradient (id="gradient") when present, else the cover width + 10%.
// Measurement is done in root units (viewBox space) via getBBox()+getScreenCTM();
// clips/masks are then built in each field's LOCAL space using its scale factor.

const SVG_NS = "http://www.w3.org/2000/svg";

export type SlotName = "title" | "artist";

export interface SlotMetrics {
  present: boolean;
  /** Field text width in root units. */
  widthRoot: number;
  /** Smart default window width in root units. */
  suggestedThresholdRoot: number;
  /** Left-fade width as a fraction of the window. */
  fadeRatio: number;
}

export interface TextMetrics {
  viewBoxWidth: number;
  title: SlotMetrics;
  artist: SlotMetrics;
}

export interface SlotOptions {
  thresholdRoot: number;
  offsetRoot: number;
  fadeRatio?: number;
}

interface SlotGeom extends SlotMetrics {
  leftRoot: number;
  bboxLocal: { x: number; y: number; width: number; height: number };
  scaleX: number;
}

interface FullMeasurement {
  viewBoxWidth: number;
  title: SlotGeom;
  artist: SlotGeom;
}

const DEFAULT_FADE_RATIO = 0.2; // fallback when there's no gradient to measure
// The left fade is the gradient's fade span scaled down a touch — tuned so the
// t_CurrentSong template (span ≈24%) lands ~20%. Easy to drop/replace later.
const LEFT_FADE_FACTOR = 0.82;

const EMPTY_SLOT: SlotGeom = {
  present: false,
  widthRoot: 0,
  suggestedThresholdRoot: 0,
  fadeRatio: DEFAULT_FADE_RATIO,
  leftRoot: 0,
  bboxLocal: { x: 0, y: 0, width: 0, height: 0 },
  scaleX: 1,
};

function tagOf(el: Element): string {
  return (el.localName || el.tagName || "").toLowerCase();
}

function findByTemplateOrId(root: Element, name: string): Element | null {
  const stack: Element[] = [root];
  while (stack.length) {
    const el = stack.shift()!;
    if (el.getAttribute("template-id") === name || el.getAttribute("id") === name) {
      return el;
    }
    for (const c of Array.from(el.children)) stack.push(c);
  }
  return null;
}

function descendantByTag(el: Element, tag: string): Element | null {
  const stack: Element[] = [...Array.from(el.children)];
  while (stack.length) {
    const e = stack.shift()!;
    if (tagOf(e) === tag) return e;
    for (const c of Array.from(e.children)) stack.push(c);
  }
  return null;
}

function slotTextEl(root: Element, name: SlotName): Element | null {
  const slot = findByTemplateOrId(root, name);
  if (!slot) return null;
  return tagOf(slot) === "text" || tagOf(slot) === "tspan"
    ? slot
    : descendantByTag(slot, "text");
}

function coverEl(root: Element): Element | null {
  const slot = findByTemplateOrId(root, "cover");
  if (!slot) return null;
  return tagOf(slot) === "rect" ? slot : descendantByTag(slot, "rect") ?? slot;
}

function viewBoxSize(root: Element): { w: number; h: number } | null {
  const vb = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  return vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? { w: vb[2], h: vb[3] } : null;
}

function scaleXToRoot(el: Element): number {
  const ctm = (el as unknown as SVGGraphicsElement).getScreenCTM();
  return ctm ? Math.abs(ctm.a) || 1 : 1;
}

function parseMatrix(
  transform: string | null,
): [number, number, number, number, number, number] {
  const m = transform?.match(/matrix\(\s*([^)]+)\)/i);
  if (!m) return [1, 0, 0, 1, 0, 0];
  const n = m[1].split(/[\s,]+/).map(Number);
  return n.length === 6 && n.every(Number.isFinite)
    ? (n as [number, number, number, number, number, number])
    : [1, 0, 0, 1, 0, 0];
}

function stopOpacity(stop: Element): number {
  const attr = stop.getAttribute("stop-opacity");
  if (attr != null) return Number(attr);
  const m = (stop.getAttribute("style") || "").match(/stop-opacity\s*:\s*([\d.]+)/);
  return m ? Number(m[1]) : 1;
}

function stopOffset(stop: Element): number {
  const raw = (stop.getAttribute("offset") || "0").trim();
  return raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
}

/** Root-space x where the hider gradient starts fading and is fully opaque. */
function hiderFade(
  probe: SVGSVGElement,
): { fadeStartRootX: number; fullyHiddenRootX: number } | null {
  const slot = findByTemplateOrId(probe, "gradient");
  if (!slot) return null;
  const rect = tagOf(slot) === "rect" ? slot : descendantByTag(slot, "rect");
  if (!rect) return null;

  const fill = rect.getAttribute("fill") || rect.getAttribute("style") || "";
  const idMatch = fill.match(/url\(["']?#([^"')]+)["']?\)/);
  if (!idMatch) return null;
  const grad = probe.querySelector(`[id="${idMatch[1]}"]`);
  if (!grad || tagOf(grad) !== "lineargradient") return null;
  if ((grad.getAttribute("gradientUnits") || "") !== "userSpaceOnUse") return null;

  const x1 = Number(grad.getAttribute("x1") ?? "0");
  const x2 = Number(grad.getAttribute("x2") ?? "1");
  const y1 = Number(grad.getAttribute("y1") ?? "0");
  const y2 = Number(grad.getAttribute("y2") ?? "0");
  const gt = parseMatrix(grad.getAttribute("gradientTransform"));
  const ctm = (rect as unknown as SVGGraphicsElement).getScreenCTM();
  if (!ctm) return null;

  const rootXAtOffset = (o: number): number => {
    const gx = x1 + o * (x2 - x1);
    const gy = y1 + o * (y2 - y1);
    const rx = gt[0] * gx + gt[2] * gy + gt[4];
    const ry = gt[1] * gx + gt[3] * gy + gt[5];
    return new DOMPoint(rx, ry).matrixTransform(ctm).x;
  };

  const stops = Array.from(grad.getElementsByTagName("stop"))
    .map((s) => ({ offset: stopOffset(s), opacity: stopOpacity(s) }))
    .sort((a, b) => a.offset - b.offset);
  if (stops.length < 2) return null;

  let fadeStart = stops[0].offset;
  for (const s of stops) if (s.opacity <= 0.01) fadeStart = s.offset;
  const hidden = stops.find((s) => s.opacity >= 0.99);
  const fullyHidden = hidden ? hidden.offset : stops[stops.length - 1].offset;

  return {
    fadeStartRootX: rootXAtOffset(fadeStart),
    fullyHiddenRootX: rootXAtOffset(fullyHidden),
  };
}

/** Measures title + artist (and the cover/gradient) by attaching off-screen at 1:1. */
function measureAll(svgString: string): FullMeasurement | null {
  if (typeof window === "undefined") return null;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
  } catch {
    return null;
  }
  const root = doc.documentElement;
  if (!root || tagOf(root) !== "svg") return null;
  const vb = viewBoxSize(root);
  if (!vb) return null;

  const probe = document.importNode(root, true) as unknown as SVGSVGElement;
  probe.setAttribute("width", String(vb.w));
  probe.setAttribute("height", String(vb.h));
  const holder = document.createElement("div");
  holder.setAttribute(
    "style",
    "position:absolute;left:-99999px;top:-99999px;opacity:0;",
  );
  holder.appendChild(probe);
  document.body.appendChild(holder);

  try {
    let coverWidthRoot: number | null = null;
    const cover = coverEl(probe);
    if (cover) {
      const cbb = (cover as unknown as SVGGraphicsElement).getBBox();
      coverWidthRoot = cbb.width * scaleXToRoot(cover);
    }
    const fade = hiderFade(probe);

    const measureSlot = (name: SlotName): SlotGeom => {
      const text = slotTextEl(probe, name);
      if (!text) return { ...EMPTY_SLOT };
      const bb = (text as unknown as SVGGraphicsElement).getBBox();
      const scaleX = scaleXToRoot(text);
      const widthRoot = bb.width * scaleX;
      const leftRoot = new DOMPoint(bb.x, bb.y).matrixTransform(
        (text as unknown as SVGGraphicsElement).getScreenCTM()!,
      ).x;

      let suggestedThresholdRoot: number;
      let fadeRatio = DEFAULT_FADE_RATIO;
      if (fade && fade.fullyHiddenRootX > leftRoot) {
        suggestedThresholdRoot = fade.fullyHiddenRootX - leftRoot;
        const span = fade.fullyHiddenRootX - fade.fadeStartRootX;
        if (span > 0) {
          const raw = (span / suggestedThresholdRoot) * LEFT_FADE_FACTOR;
          fadeRatio = Math.min(0.4, Math.max(0.04, raw));
        }
      } else if (coverWidthRoot) {
        suggestedThresholdRoot = coverWidthRoot * 1.1;
      } else {
        suggestedThresholdRoot = widthRoot;
      }

      return {
        present: true,
        widthRoot,
        suggestedThresholdRoot,
        fadeRatio,
        leftRoot,
        bboxLocal: { x: bb.x, y: bb.y, width: bb.width, height: bb.height },
        scaleX,
      };
    };

    return {
      viewBoxWidth: vb.w,
      title: measureSlot("title"),
      artist: measureSlot("artist"),
    };
  } catch {
    return null;
  } finally {
    document.body.removeChild(holder);
  }
}

/** Public: measure title/artist for the UI (defaults + overflow detection). */
export function measureText(svgString: string): TextMetrics {
  const pub = (s: SlotGeom): SlotMetrics => ({
    present: s.present,
    widthRoot: s.widthRoot,
    suggestedThresholdRoot: s.suggestedThresholdRoot,
    fadeRatio: s.fadeRatio,
  });
  const m = measureAll(svgString);
  if (!m) {
    return { viewBoxWidth: 0, title: pub(EMPTY_SLOT), artist: pub(EMPTY_SLOT) };
  }
  return { viewBoxWidth: m.viewBoxWidth, title: pub(m.title), artist: pub(m.artist) };
}

function applySlot(
  doc: Document,
  root: Element,
  defs: Element,
  name: SlotName,
  geom: SlotGeom,
  o: SlotOptions,
): boolean {
  const text = slotTextEl(root, name);
  if (!text || !text.parentNode) return false;

  const thresholdLocal = o.thresholdRoot / geom.scaleX;
  if (geom.bboxLocal.width <= thresholdLocal) return false; // fits — no change

  const overflowLocal = geom.bboxLocal.width - thresholdLocal;
  const offsetLocal = Math.max(
    0,
    Math.min(o.offsetRoot / geom.scaleX, overflowLocal),
  );
  const fadeLocal = thresholdLocal * (o.fadeRatio ?? 0.12);
  const { x, y, height: h } = geom.bboxLocal;
  const w = thresholdLocal;
  const fades = offsetLocal > 0;
  const uid = `imd-${name}-${Math.random().toString(36).slice(2, 8)}`;
  const parent = text.parentNode;

  const wrapper = doc.createElementNS(SVG_NS, "g");
  wrapper.setAttribute("clip-path", `url(#${uid}-clip)`);
  if (fades) wrapper.setAttribute("mask", `url(#${uid}-mask)`);

  const inner = doc.createElementNS(SVG_NS, "g");
  if (fades) inner.setAttribute("transform", `translate(${-offsetLocal} 0)`);

  parent.insertBefore(wrapper, text);
  parent.removeChild(text);
  inner.appendChild(text);
  wrapper.appendChild(inner);

  const clip = doc.createElementNS(SVG_NS, "clipPath");
  clip.setAttribute("id", `${uid}-clip`);
  clip.setAttribute("clipPathUnits", "userSpaceOnUse");
  const crect = doc.createElementNS(SVG_NS, "rect");
  crect.setAttribute("x", `${x}`);
  crect.setAttribute("y", `${y}`);
  crect.setAttribute("width", `${w}`);
  crect.setAttribute("height", `${h}`);
  clip.appendChild(crect);
  defs.appendChild(clip);

  if (fades) {
    const grad = doc.createElementNS(SVG_NS, "linearGradient");
    grad.setAttribute("id", `${uid}-grad`);
    grad.setAttribute("gradientUnits", "userSpaceOnUse");
    grad.setAttribute("x1", `${x}`);
    grad.setAttribute("y1", "0");
    grad.setAttribute("x2", `${x + fadeLocal}`);
    grad.setAttribute("y2", "0");
    const s0 = doc.createElementNS(SVG_NS, "stop");
    s0.setAttribute("offset", "0");
    s0.setAttribute("stop-color", "white");
    s0.setAttribute("stop-opacity", "0");
    const s1 = doc.createElementNS(SVG_NS, "stop");
    s1.setAttribute("offset", "1");
    s1.setAttribute("stop-color", "white");
    s1.setAttribute("stop-opacity", "1");
    grad.appendChild(s0);
    grad.appendChild(s1);
    defs.appendChild(grad);

    const mask = doc.createElementNS(SVG_NS, "mask");
    mask.setAttribute("id", `${uid}-mask`);
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.setAttribute("x", `${x}`);
    mask.setAttribute("y", `${y}`);
    mask.setAttribute("width", `${w}`);
    mask.setAttribute("height", `${h}`);
    const mrect = doc.createElementNS(SVG_NS, "rect");
    mrect.setAttribute("x", `${x}`);
    mrect.setAttribute("y", `${y}`);
    mrect.setAttribute("width", `${w}`);
    mrect.setAttribute("height", `${h}`);
    mrect.setAttribute("fill", `url(#${uid}-grad)`);
    mask.appendChild(mrect);
    defs.appendChild(mask);
  }

  return true;
}

/** Applies windowed offset + left fade to the title and/or artist fields. */
export function applyTextOffset(
  svgString: string,
  opts: { title?: SlotOptions; artist?: SlotOptions },
): string {
  const m = measureAll(svgString);
  if (!m) return svgString;

  const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || tagOf(root) !== "svg") return svgString;

  let defs = descendantByTag(root, "defs");
  if (!defs) {
    defs = doc.createElementNS(SVG_NS, "defs");
    root.appendChild(defs);
  }

  let changed = false;
  for (const name of ["title", "artist"] as SlotName[]) {
    const o = opts[name];
    if (o && m[name].present) {
      if (applySlot(doc, root, defs, name, m[name], o)) changed = true;
    }
  }

  return changed ? new XMLSerializer().serializeToString(root) : svgString;
}
