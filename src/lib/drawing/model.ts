import { getStroke, type StrokeOptions } from "perfect-freehand";
import type { Rect } from "../doc/types";

/**
 * A drawing node holds freehand strokes, drawn as filled SVG outlines (perfect-freehand), so they
 * stay sharp at any zoom. Points are in the drawing's own units; `view` is the part of that space
 * the node shows, stretched to the node's size, so a drawing scales like a picture. Adding strokes
 * outside it grows `view` (its origin can go negative); the points themselves never change.
 *
 * A stroke's points are one string ("x y p x y p …"): undo steps hold the whole `data`, and a
 * string is shared between them where an array of numbers would be copied every time.
 *
 * The points are what the pointer reported; smoothing happens when drawing them (`smoothPoints`),
 * so it can be retuned without touching saved boards.
 */

export type InkTool = "pen" | "marker";
export type NamedInk = "black" | "white" | "red" | "orange" | "yellow" | "green" | "blue" | "purple";
/** One of the eight inks, or any color as "#RRGGBB" (picked from a palette on the board). */
export type InkColor = NamedInk | `#${string}`;

// Type aliases, not interfaces: node data is typed Record<string, unknown>.
export type Stroke = {
  id: string;
  tool: InkTool;
  color: InkColor;
  /** Diameter, in the drawing's units. */
  size: number;
  /** "x y p x y p …" in the drawing's units, pressure 0–1. */
  points: string;
  /** Drawn with a pen that reports pressure; otherwise the line keeps its width. */
  pressure?: boolean;
  /** Drawing units per screen pixel when it was drawn: smoothing is measured in screen pixels. */
  px?: number;
  /**
   * Straight parts (drawn holding Shift): indices of points whose segment from the point before
   * is a straight line. Those stay exactly straight; only the freehand runs between are smoothed.
   */
  straight?: number[];
};

export type DrawingData = {
  view: Rect;
  strokes: Stroke[];
};

export function drawingData(data: unknown): DrawingData {
  const d = (data ?? {}) as Partial<DrawingData>;
  const v = d.view;
  const view = v && v.w > 0 && v.h > 0 ? v : { x: 0, y: 0, w: 1, h: 1 };
  return { view, strokes: Array.isArray(d.strokes) ? d.strokes : [] };
}

/** Fixed colors, not theme tokens: markup on a picture must look the same in either theme. */
export const INK_COLORS: Record<NamedInk, { color: string; label: string }> = {
  black: { color: "#1d1d1f", label: "Black" },
  white: { color: "#ffffff", label: "White" },
  red: { color: "#e5383b", label: "Red" },
  orange: { color: "#f3802b", label: "Orange" },
  yellow: { color: "#f5cf2c", label: "Yellow" },
  green: { color: "#34b35a", label: "Green" },
  blue: { color: "#2f7ff0", label: "Blue" },
  purple: { color: "#9b51e0", label: "Purple" },
};

/** The color a stroke is drawn in: a named ink's, or its own hex code (anything else draws black). */
export function inkColor(c: string): string {
  if (c in INK_COLORS) return INK_COLORS[c as NamedInk].color;
  return /^#[0-9a-f]{6}$/i.test(c) ? c : INK_COLORS.black.color;
}

/** A marker is see-through, so what's under it shows (a highlighter). */
export const MARKER_OPACITY = 0.4;

/** Brush sizes in screen pixels at the zoom they're drawn at: small, medium, large. */
export const SIZES = { pen: [2, 4, 8], marker: [12, 20, 32], eraser: [12, 24, 48] } as const;

/** Space kept around the strokes inside the node's box, in screen px when drawn. */
export const MARGIN_PX = 6;

export type Triple = [x: number, y: number, pressure: number];

const round = (n: number, k: number) => Math.round(n * k) / k;

export const encodePoints = (pts: Triple[]) => pts.map(([x, y, p]) => `${round(x, 100)} ${round(y, 100)} ${round(p, 100)}`).join(" ");

// Parsed points and outlines, by stroke id (strokes never change once drawn).
const parsed = new Map<string, Triple[]>();
const paths = new Map<string, string>();

export function pointsOf(s: Stroke): Triple[] {
  let pts = parsed.get(s.id);
  if (!pts) {
    const n = s.points.split(" ").map(Number);
    pts = [];
    for (let i = 0; i + 2 < n.length; i += 3) pts.push([n[i], n[i + 1], n[i + 2]]);
    parsed.set(s.id, pts);
  }
  return pts;
}

type StrokeLook = Pick<Stroke, "tool" | "size" | "pressure" | "px" | "straight">;

/**
 * The points come in smoothed already (`smoothPoints`), so perfect-freehand only adds a touch of
 * streamlining. A pen's pressure sets the width; without one the line keeps its width (pressure
 * simulated from speed means little once the points are evenly spaced).
 */
function options(s: StrokeLook, last: boolean): StrokeOptions {
  const thinning = s.tool === "pen" && s.pressure ? 0.6 : 0;
  return { size: s.size, thinning, smoothing: 0.5, streamline: 0.15, simulatePressure: false, last };
}

const dist = (a: Triple, b: Triple) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Spacing of the smoothed points, in screen px. */
const STEP_PX = 2;
/** How wide the blur is: this much of the local gap between samples, within limits (screen px). */
const BLUR = { share: 0.5, mouse: [2.5, 24], pen: [1.5, 12] } as const;
/** How far around a point (screen px) the gaps count toward its blur width. */
const GAP_REACH_PX = 30;

/**
 * Smooths what the pointer reported. The webview delivers a mouse about once a frame, in bursts:
 * clusters of samples a couple of pixels apart, then gaps of up to 30 ms and 90 px with nothing in
 * them, so a fast curve arrives as a polygon. (A browser gets every sample; that's where tldraw's
 * lines have it easier.) Drawn as they come, or through a curve that has to hit every sample, the
 * gaps show as straight runs and kinks.
 *
 * So the line is resampled evenly and blurred along its length (a Gaussian), as widely as the gaps
 * around each point are long: where samples were far apart (a fast movement, little known) it
 * rounds out the polygon; where they were close (a slow, careful movement) it only takes out the
 * wobble, and corners and small loops stay. The width changes gradually (a jump leaves a notch).
 * Symmetric, so nothing lags the pointer; the ends stay where they were drawn.
 */
/** One side of a Gaussian kernel (index = distance in samples), out to 2.5 sigma; cached per sigma in 1/8 steps. */
const kernels = new Map<number, Float64Array>();
function gaussian(sigma: number): Float64Array {
  const key = Math.round(sigma * 8);
  let w = kernels.get(key);
  if (!w) {
    const s = Math.max(1, key) / 8;
    w = new Float64Array(Math.ceil(s * 2.5) + 1);
    for (let j = 0; j < w.length; j++) w[j] = Math.exp(-(j * j) / (2 * s * s));
    kernels.set(key, w);
  }
  return w;
}

export function smoothPoints(raw: Triple[], px: number, pen: boolean): Triple[] {
  const pts = raw.filter((p, i) => i === 0 || p[0] !== raw[i - 1][0] || p[1] !== raw[i - 1][1]);
  if (pts.length < 3) return pts;

  // Even samples along the line, each with the length of the input segment it lies on.
  const step = STEP_PX * px;
  const even: Triple[] = [pts[0]];
  const gap: number[] = [dist(pts[0], pts[1])];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = dist(a, b);
    let t = step - carry;
    for (; t <= len; t += step) {
      const f = t / len;
      even.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
      gap.push(len);
    }
    carry = len - (t - step);
  }
  even.push(pts[pts.length - 1]);
  gap.push(dist(pts[pts.length - 2], pts[pts.length - 1]));

  // The longest gap nearby, then averaged: the blur width at each point, changing gradually.
  const n = even.length, reach = Math.round(GAP_REACH_PX / STEP_PX);
  const window = (i: number, f: (j: number) => void) => {
    for (let j = Math.max(0, i - reach); j <= Math.min(n - 1, i + reach); j++) f(j);
  };
  const peak = gap.map((_, i) => {
    let g = 0;
    window(i, (j) => (g = Math.max(g, gap[j])));
    return g;
  });
  const [lo, hi] = pen ? BLUR.pen : BLUR.mouse;
  const sigmas = peak.map((_, i) => {
    let g = 0, c = 0;
    window(i, (j) => ((g += peak[j]), c++));
    return Math.max(lo * px, Math.min(hi * px, (g / c) * BLUR.share)) / step;
  });

  // The blur; its reach shrinks toward the ends so they stay put.
  return even.map((p, i) => {
    const weights = gaussian(sigmas[i]);
    const k = Math.min(weights.length - 1, i, n - 1 - i);
    let x = 0, y = 0, pr = 0, sum = 0;
    for (let j = -k; j <= k; j++) {
      const w = weights[Math.abs(j)];
      const q = even[i + j];
      x += q[0] * w;
      y += q[1] * w;
      pr += q[2] * w;
      sum += w;
    }
    return [x / sum, y / sum, pr / sum];
  });
}

/** An outline polygon as a smooth closed SVG path (quadratic curves through the midpoints). */
function pathOf(outline: number[][]): string {
  if (outline.length < 3) return "";
  const f = (n: number) => round(n, 100);
  let d = `M${f(outline[0][0])},${f(outline[0][1])}Q`;
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d += `${f(x0)},${f(y0)} ${f((x0 + x1) / 2)},${f((y0 + y1) / 2)} `;
  }
  return d + "Z";
}

/** The filled outline of points drawn with a stroke's tool and size. `last`: the stroke is finished. */
/**
 * The line a stroke draws: its freehand runs smoothed, its straight segments exactly straight
 * (filled in every few pixels, so the outline follows them evenly). The corners between stay sharp.
 */
export function shapePoints(s: StrokeLook, points: Triple[]): Triple[] {
  // Strokes from before `px` was recorded: about a quarter of a medium pen.
  const px = s.px ?? s.size / 4;
  if (!s.straight?.length) return smoothPoints(points, px, !!s.pressure);
  const straight = new Set(s.straight);
  const out: Triple[] = [];
  const add = (pts: Triple[]) => out.push(...(out.length ? pts.slice(1) : pts));
  let run = 0;
  for (let i = 1; i <= points.length; i++) {
    if (i < points.length && !straight.has(i)) continue;
    // The freehand run up to here; its ends stay put, so it meets the straight parts exactly.
    add(smoothPoints(points.slice(run, i), px, !!s.pressure));
    if (i === points.length) break;
    const a = points[i - 1], b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (4 * px)));
    add(Array.from({ length: n + 1 }, (_, k): Triple => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n]));
    run = i;
  }
  return out;
}

export function outline(s: StrokeLook, points: Triple[], last = true): string {
  const smooth = shapePoints(s, points);
  // A single point (a dot) still draws: perfect-freehand needs two.
  const pts: Triple[] = smooth.length === 1 ? [smooth[0], [smooth[0][0] + 0.01, smooth[0][1] + 0.01, smooth[0][2]]] : smooth;
  return pathOf(getStroke(pts, options(s, last)));
}

export function strokePath(s: Stroke): string {
  let d = paths.get(s.id);
  if (d === undefined) {
    d = outline(s, pointsOf(s));
    paths.set(s.id, d);
  }
  return d;
}

/** Bounds of these strokes (their points, grown by half their size). */
export const strokeBounds = (strokes: Stroke[]) => pointBounds(strokes.map((s) => [pointsOf(s), s.size]));

/** Bounds of point lists, each grown by half its brush size. */
export function pointBounds(lists: [points: Triple[], size: number][]): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [points, size] of lists) {
    const r = size / 2;
    for (const [x, y] of points) {
      x0 = Math.min(x0, x - r);
      y0 = Math.min(y0, y - r);
      x1 = Math.max(x1, x + r);
      y1 = Math.max(y1, y + r);
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Distance from (px, py) to the segment a–b. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether a circle at (x, y) with radius r touches the stroke (its centerline grown by half its size). */
export function touchesStroke(s: Stroke, x: number, y: number, r: number): boolean {
  const reach = r + s.size / 2;
  const p = pointsOf(s);
  if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]) <= reach;
  for (let i = 0; i + 1 < p.length; i++) {
    if (segmentDistance(x, y, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]) <= reach) return true;
  }
  return false;
}
