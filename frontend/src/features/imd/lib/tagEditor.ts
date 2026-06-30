// Client-only. A CONSTRAINED tag editor for IMD templates.
//
// It can only add / change / remove the slot markers (the `template-id`
// attribute, plus matching `id` markers) on <text>/<rect> elements. It never
// edits arbitrary SVG content, so it cannot be used to inject anything — the
// plain-text view in the UI is read-only and every change goes through here.

export interface ModeSlot {
  slot: string;
  kind: "text" | "image";
  required: boolean;
}

function numbered(
  prefix: string,
  from: number,
  to: number,
  kind: "text" | "image",
): ModeSlot[] {
  const out: ModeSlot[] = [];
  for (let i = from; i <= to; i++) {
    out.push({ slot: `${prefix}${i}`, kind, required: false });
  }
  return out;
}

export const MODE_SLOTS: Record<string, ModeSlot[]> = {
  "current-song": [
    { slot: "artist", kind: "text", required: true },
    { slot: "title", kind: "text", required: true },
    { slot: "cover", kind: "image", required: true },
  ],
  // Current song (required) + up to 5 upcoming (2..6, optional).
  queue: [
    { slot: "current_artist", kind: "text", required: true },
    { slot: "current_title", kind: "text", required: true },
    { slot: "current_cover", kind: "image", required: true },
    ...numbered("artist", 2, 6, "text"),
    ...numbered("title", 2, 6, "text"),
    ...numbered("cover", 2, 6, "image"),
  ],
  // Up to 5 playlists (2..6); the first (2) is required, the rest optional.
  playlist: [
    { slot: "title2", kind: "text", required: true },
    { slot: "artist2", kind: "text", required: true },
    { slot: "cover2", kind: "image", required: true },
    ...numbered("title", 3, 6, "text"),
    ...numbered("artist", 3, 6, "text"),
    ...numbered("cover", 3, 6, "image"),
  ],
};

export interface Candidate {
  ref: number;
  kind: "text" | "image";
  label: string;
  currentTag: string | null;
  tagValid: boolean;
}

export interface TagAnalysis {
  ok: boolean;
  candidates: Candidate[];
  slots: ModeSlot[];
}

function tagName(el: Element): string {
  return (el.localName || el.tagName || "").toLowerCase();
}

// All taggable elements, in stable document order (so refs map back on apply).
function collectCandidates(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    const t = tagName(el);
    if (t === "text" || t === "rect") out.push(el);
    for (const c of Array.from(el.children)) walk(c);
  };
  for (const c of Array.from(root.children)) walk(c);
  return out;
}

function currentTagOf(el: Element, known: Set<string>): string | null {
  const ti = el.getAttribute("template-id");
  if (ti) return ti;
  const id = el.getAttribute("id");
  if (id && known.has(id)) return id;
  let p = el.parentElement;
  while (p) {
    const pid = p.getAttribute("id");
    if (pid && known.has(pid)) return pid;
    p = p.parentElement;
  }
  return null;
}

function labelOf(el: Element): string {
  if (tagName(el) === "text") {
    const txt = (el.textContent || "").trim().replace(/\s+/g, " ");
    return txt ? `“${txt.slice(0, 40)}”` : "(empty text)";
  }
  const w = el.getAttribute("width");
  const h = el.getAttribute("height");
  return w && h ? `rect ${Math.round(Number(w))}×${Math.round(Number(h))}` : "rect";
}

export function analyzeSvg(svg: string, mode: string): TagAnalysis {
  const slots = MODE_SLOTS[mode] ?? [];
  const known = new Set(slots.map((s) => s.slot));
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = doc.documentElement;
    if (
      !root ||
      tagName(root) !== "svg" ||
      doc.getElementsByTagName("parsererror").length > 0
    ) {
      return { ok: false, candidates: [], slots };
    }
    const candidates: Candidate[] = collectCandidates(root).map((el, i) => {
      const ct = currentTagOf(el, known);
      return {
        ref: i,
        kind: tagName(el) === "text" ? "text" : "image",
        label: labelOf(el),
        currentTag: ct,
        tagValid: ct != null && known.has(ct),
      };
    });
    return { ok: true, candidates, slots };
  } catch {
    return { ok: false, candidates: [], slots };
  }
}

export function applyTags(
  svg: string,
  mode: string,
  assignments: Record<number, string | null>,
): string {
  const slots = MODE_SLOTS[mode] ?? [];
  const known = new Set(slots.map((s) => s.slot));
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || tagName(root) !== "svg") return svg;

  const candidates = collectCandidates(root);

  // Strip every existing slot marker so the result is unambiguous.
  const strip = (el: Element) => {
    const ti = el.getAttribute("template-id");
    if (ti && known.has(ti)) el.removeAttribute("template-id");
    const id = el.getAttribute("id");
    if (id && known.has(id)) el.removeAttribute("id");
    for (const c of Array.from(el.children)) strip(c);
  };
  strip(root);

  // Write only the chosen assignments (and clear any invalid tag on a cleared one).
  candidates.forEach((el, i) => {
    const slot = assignments[i] ?? null;
    if (slot) el.setAttribute("template-id", slot);
    else el.removeAttribute("template-id");
  });

  return new XMLSerializer().serializeToString(root);
}

/** Best-guess known slot for an unrecognized tag value (for "did you mean…"). */
export function suggestSlot(value: string, slots: ModeSlot[]): string | null {
  const v = value.toLowerCase();
  const names = slots.map((s) => s.slot);
  for (const s of names) if (s === v) return s;
  for (const s of names) if (s.startsWith(v) || v.startsWith(s)) return s;
  for (const s of names) if (v.includes(s) || s.includes(v)) return s;
  return null;
}
