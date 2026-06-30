// Immersive Music Display — client-side export helpers (SVG download + PNG
// rasterization). Tool-specific; other tools (e.g. playlist→text) get their own.

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function svgStringToBlob(svg: string): Blob {
  return new Blob([svg], { type: "image/svg+xml" });
}

/** Forces explicit pixel width/height on an SVG so it rasterizes at that size. */
function setSvgPixelSize(svgString: string, width: number, height: number): string {
  const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
  const svg = doc.documentElement;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  return new XMLSerializer().serializeToString(svg);
}

/**
 * Rasterizes an SVG to a PNG Blob at the given pixel size by drawing it onto a
 * canvas. Works because the album art is inlined as a data URI (same-origin),
 * so the canvas isn't tainted.
 */
export function svgToPngBlob(
  svgString: string,
  width: number,
  height: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const sized = setSvgPixelSize(svgString, width, height);
    const url = URL.createObjectURL(svgStringToBlob(sized));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context unavailable.");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error("PNG encoding failed."));
        }, "image/png");
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not rasterize the SVG."));
    };
    img.src = url;
  });
}
