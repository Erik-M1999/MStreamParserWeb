import { describe, it, expect } from "vitest";
import { fillTemplate } from "../src/svgTemplate";

// Unit tests for fillTemplate: takes an SVG + a { text, images } fill and returns
// the filled SVG. Pure logic (no DB/network) — fixtures are tiny inline SVGs.
//
// Two slot conventions exist: classic `template-id="name"` and Affinity `id="name"`.

const CLASSIC = `<svg xmlns="http://www.w3.org/2000/svg">
  <text template-id="title">OLD TITLE</text>
  <text template-id="artist">OLD ARTIST</text>
  <rect template-id="cover" x="10" y="20" width="100" height="100"/>
</svg>`;

const AFFINITY = `<svg xmlns="http://www.w3.org/2000/svg">
  <g id="artist"><text>OLD ARTIST</text></g>
</svg>`;

const MULTI_TSPAN = `<svg xmlns="http://www.w3.org/2000/svg">
  <text template-id="title"><tspan>OLD </tspan><tspan>SPLIT TITLE</tspan></text>
</svg>`;

const noImages = {} as Record<string, string | null>;

describe("fillTemplate", () => {
  // Normal case: classic template-id text slots
  it("replaces classic template-id text slots", () => {
    const out = fillTemplate(CLASSIC, {
      text: { title: "Bohemian Rhapsody", artist: "Queen" },
      images: noImages,
    });
    expect(out).toContain("Bohemian Rhapsody");
    expect(out).toContain("Queen");
    expect(out).not.toContain("OLD TITLE");
    expect(out).not.toContain("OLD ARTIST");
  });

  // Normal case: Affinity convention (slot is a group carrying id="...")
  it("replaces text inside an Affinity id-tagged group", () => {
    const out = fillTemplate(AFFINITY, {
      text: { artist: "Pink Floyd" },
      images: noImages,
    });
    expect(out).toContain("Pink Floyd");
    expect(out).not.toContain("OLD ARTIST");
  });

  // Normal case: a title split across several <tspan>s is fully replaced
  it("fully replaces a title split across multiple tspans", () => {
    const out = fillTemplate(MULTI_TSPAN, {
      text: { title: "One Line Title" },
      images: noImages,
    });
    expect(out).toContain("One Line Title");
    expect(out).not.toContain("OLD ");
    expect(out).not.toContain("SPLIT TITLE");
  });

  // Normal case: cover rect is swapped for an <image> reusing its geometry
  it("swaps a cover rect for an <image>, reusing position and size", () => {
    const uri = "data:image/png;base64,AAAA";
    const out = fillTemplate(CLASSIC, {
      text: {},
      images: { cover: uri },
    });
    expect(out).toContain("<image");
    expect(out).toContain(`href="${uri}"`);
    expect(out).toContain('x="10"');
    expect(out).toContain('width="100"');
    expect(out).not.toContain("<rect");
  });

  // Edge case: null image entries are skipped (no <image>, rect stays)
  it("skips null image entries", () => {
    const out = fillTemplate(CLASSIC, {
      text: { title: "Still Works" },
      images: { cover: null },
    });
    expect(out).toContain("Still Works");
    expect(out).not.toContain("<image");
    expect(out).toContain("<rect"); // cover left untouched
  });

  // Edge case: nothing matches -> "no fillable slots"
  it("throws when the fill is empty", () => {
    expect(() => fillTemplate(CLASSIC, { text: {}, images: noImages })).toThrow(
      /No fillable slots/,
    );
  });

  it("throws when no slot names match the template", () => {
    expect(() =>
      fillTemplate(CLASSIC, { text: { nonexistent: "x" }, images: noImages }),
    ).toThrow(/No fillable slots/);
  });

  // Error case: the input is not a valid SVG
  it("throws when the root element is not <svg>", () => {
    expect(() =>
      fillTemplate("<html><body/></html>", { text: { title: "x" }, images: noImages }),
    ).toThrow(/not a valid SVG/);
  });

  it("throws on non-XML garbage input", () => {
    // Note: for pure garbage the xmldom parser throws "missing root element"
    // itself (before fillTemplate's friendly guard), so we only assert it rejects.
    expect(() =>
      fillTemplate("just some plain text", { text: { title: "x" }, images: noImages }),
    ).toThrow();
  });

  it("XML-escapes text values (no markup injection)", () => {
    const out = fillTemplate(CLASSIC, {
      text: { title: 'AC/DC & <script>alert(1)</script>' },
      images: noImages,
    });
    expect(out).toContain("&amp;");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script>");
  });

  // Defense-in-depth: an uploaded template carrying active content is stripped
  // on render (the CSP in shared/svgResponse.ts is the second layer).
  describe("active-content stripping", () => {
    it("removes <script> elements, including nested ones", () => {
      const hostile = `<svg xmlns="http://www.w3.org/2000/svg">
        <script>alert(1)</script>
        <g><foreignObject><script>alert(2)</script></foreignObject></g>
        <text template-id="title">OLD</text>
      </svg>`;
      const out = fillTemplate(hostile, { text: { title: "safe" }, images: noImages });
      expect(out).not.toContain("<script");
      expect(out).not.toContain("alert(");
      expect(out).toContain("safe"); // the legitimate fill still happened
    });

    it("removes on* event-handler attributes", () => {
      const hostile = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
        <text template-id="title" onclick="steal()" ONMOUSEOVER="x()">OLD</text>
      </svg>`;
      const out = fillTemplate(hostile, { text: { title: "safe" }, images: noImages });
      expect(out).not.toMatch(/onload|onclick/i);
      expect(out).not.toMatch(/ONMOUSEOVER/i);
    });

    it("removes javascript: URLs but keeps ordinary hrefs", () => {
      const hostile = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <a href="javascript:alert(1)"><text template-id="title">OLD</text></a>
        <a xlink:href="JavaScript:alert(2)"><text template-id="artist">OLD</text></a>
        <a href="https://example.com/ok"><text template-id="cover">keep</text></a>
      </svg>`;
      const out = fillTemplate(hostile, {
        text: { title: "safe", artist: "safe" },
        images: noImages,
      });
      expect(out).not.toMatch(/javascript:/i);
      expect(out).toContain("https://example.com/ok");
    });

    it("leaves a clean template untouched", () => {
      const out = fillTemplate(CLASSIC, {
        text: { title: "T", artist: "A" },
        images: noImages,
      });
      expect(out).toContain("T");
      expect(out).toContain("A");
      expect(out).toContain('template-id="cover"');
    });
  });
});
