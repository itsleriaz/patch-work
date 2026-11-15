/**
 * A palette node: a title and a strip of color swatches, each with its hex code. Colors come from
 * the eyedropper (any picture on the board) or are extracted from a picture. Height follows the
 * content; the font size scales the card, like other flowing cards.
 */

// Type aliases, not interfaces: node data is typed Record<string, unknown>.
export type Swatch = { id: string; hex: string };

export type PaletteData = {
  title: string;
  colors: Swatch[];
  /** World units; the card scales with it. */
  fontSize: number;
};

export const DEFAULT_PALETTE: PaletteData = { title: "", colors: [], fontSize: 16 };

export function paletteData(data: unknown): PaletteData {
  const d = { ...DEFAULT_PALETTE, ...(data as Partial<PaletteData> | null) };
  return { ...d, colors: Array.isArray(d.colors) ? d.colors.filter((c) => typeof c?.hex === "string") : [] };
}

export const newSwatch = (hex: string): Swatch => ({ id: crypto.randomUUID(), hex: hex.toUpperCase() });

// ---------------------------------------------------------------- color formats

export type Rgb = [r: number, g: number, b: number];

export const toHex = ([r, g, b]: Rgb) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

export function fromHex(hex: string): Rgb {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbText = (hex: string) => `rgb(${fromHex(hex).join(", ")})`;

export function hslText(hex: string): string {
  const [r, g, b] = fromHex(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

/** Hue (0–360), saturation and value (0–1): the color picker's model. */
export type Hsv = [h: number, s: number, v: number];

export function toHsv(hex: string): Hsv {
  const [r, g, b] = fromHex(hex).map((c) => c / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

export function fromHsv([h, s, v]: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return toHex([f(5), f(3), f(1)]);
}

/** A hex code as typed: "#abc", "abc", "#aabbcc" or "aabbcc"; null when it isn't one. */
export function normalizeHex(text: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return "#" + h.toUpperCase();
}

/**
 * The hex codes in a pasted text, in order, without repeats: "#abc" and "#aabbcc" anywhere, bare
 * "aabbcc" only as a word of its own (so ordinary words and numbers don't count). `only`: whether
 * the text is nothing but codes and separators (a list copied from another palette tool).
 */
export function hexCodesIn(text: string): { codes: string[]; only: boolean } {
  const re = /#([0-9a-f]{6}|[0-9a-f]{3})\b|(?<![\w#])([0-9a-f]{6})\b/gi;
  const codes: string[] = [];
  for (const m of text.matchAll(re)) {
    const hex = normalizeHex(m[1] ?? m[2]);
    if (hex && !codes.includes(hex)) codes.push(hex);
  }
  const only = codes.length > 0 && text.replace(re, "").replace(/[\s,;|"'`[\]()]+/g, "") === "";
  return { codes, only };
}

/** Swatches ordered by hue (greys first, dark to light), or by lightness (light to dark). */
export function sortSwatches(colors: Swatch[], by: "hue" | "lightness"): Swatch[] {
  const key = (c: Swatch) => {
    const [h, s, v] = toHsv(c.hex);
    return by === "lightness" ? [-luminance(c.hex)] : s < 0.12 || v < 0.08 ? [-1, luminance(c.hex)] : [h, -v];
  };
  return [...colors].sort((a, b) => {
    const ka = key(a), kb = key(b);
    return ka[0] - kb[0] || (ka[1] ?? 0) - (kb[1] ?? 0);
  });
}

// ---------------------------------------------------------------- swatch files

/** A GIMP palette (.gpl; also read by Krita, Inkscape and Aseprite). */
export function toGpl(title: string, colors: Swatch[]): string {
  const lines = ["GIMP Palette", `Name: ${title.trim() || "Palette"}`, `Columns: ${Math.min(8, Math.max(1, colors.length))}`, "#"];
  for (const c of colors) lines.push(`${fromHex(c.hex).map((v) => String(v).padStart(3)).join(" ")}\t${c.hex}`);
  return lines.join("\n") + "\n";
}

/** One hex code per line. */
export const toHexList = (colors: Swatch[]) => colors.map((c) => c.hex).join("\n") + "\n";

/**
 * An Adobe Swatch Exchange file (.ase; Photoshop, Illustrator, Affinity, Procreate): a group named
 * after the palette holding one RGB color per swatch, named by its hex code. Big-endian throughout.
 */
export function toAse(title: string, colors: Swatch[]): Uint8Array<ArrayBuffer> {
  const parts: number[] = [];
  const u16 = (n: number) => parts.push((n >> 8) & 255, n & 255);
  const u32 = (n: number) => parts.push((n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
  const f32 = (n: number) => {
    const b = new DataView(new ArrayBuffer(4));
    b.setFloat32(0, n);
    parts.push(...new Uint8Array(b.buffer));
  };
  // A name: its length in UTF-16 units including the closing zero, then the units.
  const name = (s: string) => {
    u16(s.length + 1);
    for (let i = 0; i < s.length; i++) u16(s.charCodeAt(i));
    u16(0);
  };
  const nameSize = (s: string) => 2 + (s.length + 1) * 2;
  const group = title.trim() || "Palette";

  parts.push(..."ASEF".split("").map((c) => c.charCodeAt(0)));
  u16(1), u16(0); // version 1.0
  u32(colors.length + 2); // the group's start and end, and the colors
  u16(0xc001), u32(nameSize(group)), name(group);
  for (const c of colors) {
    u16(0x0001), u32(nameSize(c.hex) + 4 + 12 + 2), name(c.hex);
    parts.push(..."RGB ".split("").map((ch) => ch.charCodeAt(0)));
    for (const v of fromHex(c.hex)) f32(v / 255);
    u16(2); // a normal (not global or spot) color
  }
  u16(0xc002), u32(0);
  return new Uint8Array(parts);
}

/** Relative luminance (WCAG), 0–1. */
export function luminance(hex: string): number {
  const [r, g, b] = fromHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---------------------------------------------------------------- extracting

/** How many colors an extracted palette has at most, and the least share of the picture one must cover. */
const EXTRACT_MAX = 8;
const EXTRACT_MIN_SHARE = 0.015;
/** Colors closer than this (RGB distance) count as one. */
const MERGE_DISTANCE = 28;

const dist2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * The dominant colors of an image's pixels (RGBA bytes), most common first: k-means with k-means++
 * starts (seeded, so the same picture always gives the same palette), near-duplicates merged,
 * colors covering almost nothing dropped. Transparent pixels don't count.
 */
export function extractColors(pixels: Uint8ClampedArray, k = 12): string[] {
  const pts: Rgb[] = [];
  for (let i = 0; i + 3 < pixels.length; i += 4) if (pixels[i + 3] >= 128) pts.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  if (!pts.length) return [];
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // k-means++: each new center picked with probability by its squared distance to the nearest one.
  const centers: Rgb[] = [pts[Math.floor(random() * pts.length)]];
  const nearest = pts.map((p) => dist2(p, centers[0]));
  while (centers.length < Math.min(k, pts.length)) {
    const total = nearest.reduce((a, b) => a + b, 0);
    if (!total) break;
    let r = random() * total, i = 0;
    while ((r -= nearest[i]) > 0 && i < pts.length - 1) i++;
    centers.push(pts[i]);
    pts.forEach((p, j) => (nearest[j] = Math.min(nearest[j], dist2(p, pts[i]))));
  }

  const owner = new Int32Array(pts.length);
  for (let iter = 0; iter < 16; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    pts.forEach((p, j) => {
      let best = 0, bestD = Infinity;
      centers.forEach((c, ci) => {
        const d = dist2(p, c);
        if (d < bestD) (bestD = d), (best = ci);
      });
      owner[j] = best;
      const s = sums[best];
      s[0] += p[0], s[1] += p[1], s[2] += p[2], s[3]++;
    });
    let moved = false;
    sums.forEach((s, ci) => {
      if (!s[3]) return;
      const c: Rgb = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      if (dist2(c, centers[ci]) > 0.25) moved = true;
      centers[ci] = c;
    });
    if (!moved) break;
  }

  const counts = centers.map(() => 0);
  owner.forEach((o) => counts[o]++);
  let clusters = centers.map((c, i) => ({ c, n: counts[i] })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  // Near-duplicates join the bigger one.
  const merged: typeof clusters = [];
  for (const x of clusters) {
    const into = merged.find((m) => dist2(m.c, x.c) < MERGE_DISTANCE ** 2);
    if (into) {
      const n = into.n + x.n;
      into.c = [(into.c[0] * into.n + x.c[0] * x.n) / n, (into.c[1] * into.n + x.c[1] * x.n) / n, (into.c[2] * into.n + x.c[2] * x.n) / n];
      into.n = n;
    } else merged.push({ ...x });
  }
  clusters = merged.sort((a, b) => b.n - a.n).filter((x) => x.n / pts.length >= EXTRACT_MIN_SHARE);
  return clusters.slice(0, EXTRACT_MAX).map((x) => toHex(x.c));
}
