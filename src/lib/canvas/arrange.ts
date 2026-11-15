import type { Rect } from "../doc/types";

/**
 * Arranging boxes (nodes' rotation-aware bounds): pure functions returning where each box moves,
 * as offsets by id. Boxes that don't move are left out.
 */

export type Box = Rect & { id: string };
export type Edge = "left" | "right" | "top" | "bottom";
export type Offsets = Map<string, { dx: number; dy: number }>;

/** A box seen along an axis: start and size on it, and the same across it. */
interface Span {
  id: string;
  start: number;
  size: number;
  crossStart: number;
  crossSize: number;
}

const overlaps = (a: Span, b: Span) => a.crossStart < b.crossStart + b.crossSize && b.crossStart < a.crossStart + a.crossSize;

/**
 * Stacks boxes against an edge, like PureRef's align: each box slides towards the edge until it
 * meets the edge (the selection's outermost one) or a box already placed in its way, with `gap`
 * between them. Boxes nearest the edge go first, so nothing ends up overlapping along the way.
 */
export function stack(boxes: Box[], edge: Edge, gap: number): Offsets {
  const horizontal = edge === "left" || edge === "right";
  // Mirror right and bottom so every edge becomes "towards smaller values".
  const sign = edge === "right" || edge === "bottom" ? -1 : 1;
  const spans: Span[] = boxes.map((b) => {
    const [start, size, crossStart, crossSize] = horizontal ? [b.x, b.w, b.y, b.h] : [b.y, b.h, b.x, b.w];
    return { id: b.id, start: sign > 0 ? start : -(start + size), size, crossStart, crossSize };
  });
  const line = Math.min(...spans.map((s) => s.start));
  spans.sort((a, b) => a.start - b.start || a.crossStart - b.crossStart);

  const placed: Span[] = [];
  const out: Offsets = new Map();
  for (const s of spans) {
    let to = line;
    for (const p of placed) if (overlaps(p, s)) to = Math.max(to, p.start + p.size + gap);
    placed.push({ ...s, start: to });
    const d = (to - s.start) * sign;
    if (Math.abs(d) > 1e-6) out.set(s.id, horizontal ? { dx: d, dy: 0 } : { dx: 0, dy: d });
  }
  return out;
}

/**
 * Lines boxes up next to each other in a row ("x") or a column ("y"), in their current order,
 * `gap` apart, with their centers on one line. The result keeps the selection's top-left corner:
 * the row starts at the leftmost edge (a column at the topmost), and its largest box touches the
 * topmost edge (a column's, the leftmost), so switching between rows and columns doesn't drift.
 */
export function lineUp(boxes: Box[], axis: "x" | "y", gap: number): Offsets {
  if (!boxes.length) return new Map();
  const row = axis === "x";
  const center = (b: Box) => (row ? b.x + b.w / 2 : b.y + b.h / 2);
  const sorted = [...boxes].sort((a, b) => center(a) - center(b) || (row ? a.y - b.y : a.x - b.x));
  const crossMin = Math.min(...boxes.map((b) => (row ? b.y : b.x)));
  const crossLargest = Math.max(...boxes.map((b) => (row ? b.h : b.w)));
  const middle = crossMin + crossLargest / 2;

  const out: Offsets = new Map();
  let cursor = Math.min(...boxes.map((b) => (row ? b.x : b.y)));
  for (const b of sorted) {
    const [start, size, crossStart, crossSize] = row ? [b.x, b.w, b.y, b.h] : [b.y, b.h, b.x, b.w];
    const along = cursor - start;
    const across = middle - crossSize / 2 - crossStart;
    cursor += size + gap;
    if (Math.abs(along) > 1e-6 || Math.abs(across) > 1e-6) out.set(b.id, row ? { dx: along, dy: across } : { dx: across, dy: along });
  }
  return out;
}

/** A skyline segment: the packed height `y` over [x, x + w). */
interface Segment {
  x: number;
  y: number;
  w: number;
}

type Item = { id: string; w: number; h: number };

/**
 * Skyline packing into a strip `width` wide: each item goes where its top edge ends up highest
 * (smallest y + h), then leftmost. Items come in the order given. Null if one is wider than the strip.
 */
function skyline(items: Item[], width: number) {
  const segs: Segment[] = [{ x: 0, y: 0, w: width }];
  const at = new Map<string, { x: number; y: number }>();
  let used = 0, height = 0;
  for (const item of items) {
    let best: { i: number; x: number; y: number } | null = null;
    for (let i = 0; i < segs.length; i++) {
      const x = segs[i].x;
      if (x + item.w > width + 1e-6) break;
      let y = 0, left = item.w, j = i;
      while (left > 1e-6 && j < segs.length) {
        y = Math.max(y, segs[j].y);
        left -= segs[j].w;
        j++;
      }
      if (left > 1e-6) break;
      if (!best || y + item.h < best.y + item.h - 1e-6 || (Math.abs(y - best.y) < 1e-6 && x < best.x)) best = { i, x, y };
    }
    if (!best) return null;
    at.set(item.id, { x: best.x, y: best.y });
    used = Math.max(used, best.x + item.w);
    height = Math.max(height, best.y + item.h);

    // Raise the skyline under the item: cut the covered segments, insert the item's top.
    const end = best.x + item.w;
    const next: Segment[] = [];
    for (const s of segs) {
      const sEnd = s.x + s.w;
      if (sEnd <= best.x + 1e-6 || s.x >= end - 1e-6) next.push(s);
      else if (s.x < best.x) next.push({ ...s, w: best.x - s.x });
      if (sEnd > end + 1e-6 && s.x < end) next.push({ x: end, y: s.y, w: sEnd - end });
    }
    next.push({ x: best.x, y: best.y + item.h, w: item.w });
    next.sort((a, b) => a.x - b.x);
    segs.length = 0;
    for (const s of next) {
      const prev = segs[segs.length - 1];
      if (prev && Math.abs(prev.y - s.y) < 1e-6) prev.w += s.w;
      else segs.push(s);
    }
  }
  return { at, w: used, h: height };
}

/**
 * Packs boxes into a compact block, like PureRef's optimal arrange: tallest first, smaller ones
 * filling the gaps, `gap` apart. Of a range of block widths, it keeps the arrangement that would
 * show largest in a view of `view`'s shape. The block starts at the boxes' top-left corner, and
 * ties are broken by id, so packing a packed selection again changes nothing.
 */
export function pack(boxes: Box[], gap: number, view: { w: number; h: number }): Offsets {
  if (boxes.length < 2) return new Map();
  // Each item carries its gap on the right and bottom; the strip is one gap wider to match.
  const items: Item[] = boxes
    .map((b) => ({ id: b.id, w: b.w + gap, h: b.h + gap }))
    .sort((a, b) => b.h - a.h || b.w - a.w || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const widest = Math.max(...items.map((i) => i.w));
  const total = items.reduce((sum, i) => sum + i.w, 0);

  let best: { at: Map<string, { x: number; y: number }>; score: number; area: number } | null = null;
  const STEPS = 48;
  for (let k = 0; k <= STEPS; k++) {
    const width = widest * Math.pow(total / widest, k / STEPS);
    const r = skyline(items, width);
    if (!r) continue;
    const w = r.w - gap, h = r.h - gap;
    // How far the view would have to zoom out to show the whole block: smaller is better.
    const score = Math.max(w / view.w, h / view.h), area = w * h;
    if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && area < best.area)) best = { at: r.at, score, area };
  }
  if (!best) return new Map();

  const left = Math.min(...boxes.map((b) => b.x)), top = Math.min(...boxes.map((b) => b.y));
  const out: Offsets = new Map();
  for (const b of boxes) {
    const p = best.at.get(b.id)!;
    const dx = left + p.x - b.x, dy = top + p.y - b.y;
    if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) out.set(b.id, { dx, dy });
  }
  return out;
}
