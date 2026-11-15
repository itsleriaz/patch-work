import { rotate, type Point } from "../doc/geometry";
import { pinRightAnchor } from "../pin/model";
import type { CanvasNode, LinkShape, LinkSide, Rect } from "../doc/types";

/** Where a link meets a node: a side's midpoint and that side's outward normal (world). */
export interface Anchor {
  p: Point;
  n: Point;
}

export interface LinkPath {
  from: Anchor;
  to: Anchor;
  /** SVG path data. */
  d: string;
  /** Where the label goes: halfway along the curve, or the middle of an elbow's middle segment. */
  mid: Point;
  /** Direction the path arrives at `to`, and leaves `from` (reversed), in degrees: arrowheads. */
  endAngle: number;
  startAngle: number;
  /** Loose bounds, for culling. */
  bounds: Rect;
  /** Points along the path, close enough together for hit tests (the marquee). */
  samples: Point[];
}

/** Sides by outward direction, in a node's own frame. */
export const SIDES: Record<LinkSide, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** A pinned side for each end; null means the side facing the other end. */
export interface PinnedSides {
  from?: LinkSide | null;
  to?: LinkSide | null;
}

/** How far an elbow leaves a side before it may turn. */
const STUB = 24;
/** Corner rounding of elbows. */
const RADIUS = 10;

const center = (n: CanvasNode): Point => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

/**
 * The side of `node` that faces `toward`, in the node's own (rotated) frame, so links leave
 * from the edge pointing at the other end.
 */
export function anchor(node: CanvasNode, toward: Point, pinned?: LinkSide | null): Anchor {
  if (pinned) return sideAnchor(node, pinned);
  const c = center(node);
  const local = rotate({ x: toward.x - c.x, y: toward.y - c.y }, -node.rotation);
  const horizontal = Math.abs(local.x) / Math.max(1, node.w) > Math.abs(local.y) / Math.max(1, node.h);
  const side: LinkSide = horizontal ? (local.x < 0 ? "left" : "right") : local.y < 0 ? "top" : "bottom";
  return sideAnchor(node, side);
}

/** The midpoint of one side of a (rotated) node, with that side's outward normal. */
export function sideAnchor(node: CanvasNode, side: LinkSide): Anchor {
  // A titled pin's right side is the end of its title flag (pins are never rotated).
  if (side === "right" && node.kind === "pin") {
    const p = pinRightAnchor(node);
    if (p) return { p, n: { x: 1, y: 0 } };
  }
  const c = center(node), dir = SIDES[side];
  const p = rotate({ x: (dir.x * node.w) / 2, y: (dir.y * node.h) / 2 }, node.rotation);
  return { p: { x: c.x + p.x, y: c.y + p.y }, n: rotate(dir, node.rotation) };
}

/** Where a side's link handle sits: `gap` world units out from the side's midpoint. */
export function sideDot(node: CanvasNode, side: LinkSide, gap: number): Point {
  const a = sideAnchor(node, side);
  return { x: a.p.x + a.n.x * gap, y: a.p.y + a.n.y * gap };
}

/** The side whose handle is nearest to `p`, if within `reach` world units. */
export function sideNear(node: CanvasNode, p: Point, gap: number, reach: number): LinkSide | null {
  let best: { side: LinkSide; d: number } | null = null;
  for (const side of Object.keys(SIDES) as LinkSide[]) {
    const dot = sideDot(node, side, gap);
    const d = Math.hypot(p.x - dot.x, p.y - dot.y);
    if (d <= reach && (!best || d < best.d)) best = { side, d };
  }
  return best?.side ?? null;
}

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

const angle = (from: Point, to: Point) => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;

function boundsOf(points: Point[]): Rect {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

/** How far control points reach out from each side: longer links bend more gently. */
function reach(a: Point, b: Point) {
  return Math.min(240, Math.max(30, Math.hypot(b.x - a.x, b.y - a.y) * 0.4));
}

function curve(from: Anchor, to: Anchor): LinkPath {
  const k = reach(from.p, to.p);
  const c1 = { x: from.p.x + from.n.x * k, y: from.p.y + from.n.y * k };
  const c2 = { x: to.p.x + to.n.x * k, y: to.p.y + to.n.y * k };
  const samples = Array.from({ length: 25 }, (_, i) => bezier(from.p, c1, c2, to.p, i / 24));
  return {
    samples,
    from,
    to,
    d: `M${from.p.x},${from.p.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${to.p.x},${to.p.y}`,
    mid: bezier(from.p, c1, c2, to.p, 0.5),
    endAngle: angle(c2, to.p),
    startAngle: angle(c1, from.p),
    bounds: boundsOf([from.p, to.p, c1, c2]),
  };
}

/** A normal snapped to the nearest screen axis. */
function axis(n: Point): Point {
  return Math.abs(n.x) >= Math.abs(n.y) ? { x: Math.sign(n.x) || 1, y: 0 } : { x: 0, y: Math.sign(n.y) || 1 };
}

/**
 * Corner points of a right-angled path that leaves `from` along its side's normal and arrives
 * perpendicular to `to`'s side. Segments are screen-axis-aligned; no routing around nodes.
 */
function elbowPoints(from: Anchor, to: Anchor): Point[] {
  const p0 = from.p, p3 = to.p;
  const da = axis(from.n), db = axis(to.n);
  const a = { x: p0.x + da.x * STUB, y: p0.y + da.y * STUB };
  const b = { x: p3.x + db.x * STUB, y: p3.y + db.y * STUB };
  const horizontal = da.x !== 0;

  if (horizontal === (db.x !== 0)) {
    // Both sides face along the same axis. `along` reads that axis, `pt` builds a point from it.
    const along = (p: Point) => (horizontal ? p.x : p.y);
    const across = (p: Point) => (horizontal ? p.y : p.x);
    const pt = (u: number, v: number): Point => (horizontal ? { x: u, y: v } : { x: v, y: u });
    const dirA = along(da), dirB = along(db);
    if (dirA === -dirB && (along(p3) - along(p0)) * dirA > 0) {
      // Facing each other: turn halfway between them.
      const m = (along(p0) + along(p3)) / 2;
      return [p0, pt(m, across(p0)), pt(m, across(p3)), p3];
    }
    if (dirA === dirB) {
      // Facing the same way: a U-turn around the end that sticks out further.
      const m = dirA > 0 ? Math.max(along(a), along(b)) : Math.min(along(a), along(b));
      return [p0, pt(m, across(p0)), pt(m, across(p3)), p3];
    }
    // Facing away from each other: step sideways halfway between them.
    const m = (across(p0) + across(p3)) / 2;
    return [p0, a, pt(along(a), m), pt(along(b), m), b, p3];
  }

  // Perpendicular sides: one corner when it lies ahead of both, otherwise turn after the stubs.
  const c = horizontal ? { x: p3.x, y: p0.y } : { x: p0.x, y: p3.y };
  const ahead = (p: Point, from: Point, dir: Point) => (p.x - from.x) * dir.x + (p.y - from.y) * dir.y > 0;
  if (ahead(c, p0, da) && ahead(c, p3, db)) return [p0, c, p3];
  return [p0, a, horizontal ? { x: a.x, y: b.y } : { x: b.x, y: a.y }, b, p3];
}

/** Drops repeated points and points in the middle of a straight run. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(p.x - last.x) < 0.01 && Math.abs(p.y - last.y) < 0.01) continue;
    const prev = out[out.length - 2];
    if (prev && last && Math.abs((last.x - prev.x) * (p.y - last.y) - (last.y - prev.y) * (p.x - last.x)) < 0.01) {
      out[out.length - 1] = p;
      // A run that doubled back onto its start leaves a repeated point.
      if (Math.abs(p.x - prev.x) < 0.01 && Math.abs(p.y - prev.y) < 0.01) out.pop();
      continue;
    }
    out.push(p);
  }
  return out.length >= 2 ? out : [points[0], points[points.length - 1]];
}

/** Path data through `points`, with corners rounded by up to `RADIUS`. */
function roundedPath(points: Point[]): string {
  const n = points.length;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < n - 1; i++) {
    const a = points[i - 1], p = points[i], b = points[i + 1];
    const la = Math.hypot(p.x - a.x, p.y - a.y), lb = Math.hypot(b.x - p.x, b.y - p.y);
    // Each segment is shared by two corners, except the first and last ones.
    const r = Math.min(RADIUS, i === 1 ? la : la / 2, i === n - 2 ? lb : lb / 2);
    const u = { x: (p.x - a.x) / la, y: (p.y - a.y) / la }, v = { x: (b.x - p.x) / lb, y: (b.y - p.y) / lb };
    d += ` L${p.x - u.x * r},${p.y - u.y * r} Q${p.x},${p.y} ${p.x + v.x * r},${p.y + v.y * r}`;
  }
  return d + ` L${points[n - 1].x},${points[n - 1].y}`;
}

/** The middle segment's midpoint, or halfway along the path when there's no single middle. */
function polylineMid(points: Point[]): Point {
  const segments = points.length - 1;
  if (segments % 2 === 1) {
    const a = points[(segments - 1) / 2], b = points[(segments + 1) / 2];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let left = lengths.reduce((s, l) => s + l, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] ? left / lengths[i] : 0, a = points[i], b = points[i + 1];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= lengths[i];
  }
  return points[0];
}

function polyline(from: Anchor, to: Anchor, corners: Point[]): LinkPath {
  const points = simplify(corners);
  const n = points.length;
  return {
    samples: points,
    from,
    to,
    d: roundedPath(points),
    mid: polylineMid(points),
    endAngle: angle(points[n - 2], points[n - 1]),
    startAngle: angle(points[1], points[0]),
    bounds: boundsOf(points),
  };
}

function shaped(from: Anchor, to: Anchor, shape: LinkShape): LinkPath {
  if (shape === "straight") return polyline(from, to, [from.p, to.p]);
  if (shape === "elbow") return polyline(from, to, elbowPoints(from, to));
  return curve(from, to);
}

/** The path between two nodes, each anchored on its pinned side or the side facing the other. */
export function linkPath(a: CanvasNode, b: CanvasNode, shape: LinkShape, sides: PinnedSides = {}): LinkPath {
  return shaped(anchor(a, center(b), sides.from), anchor(b, center(a), sides.to), shape);
}

/** A link being dragged out from `a` toward a free point. */
export function draftPath(a: CanvasNode, to: Point, shape: LinkShape, side?: LinkSide | null): LinkPath {
  const from = anchor(a, to, side);
  // The loose end arrives straight from the source side's direction of travel.
  const dx = to.x - from.p.x, dy = to.y - from.p.y;
  const len = Math.hypot(dx, dy) || 1;
  return shaped(from, { p: to, n: { x: -dx / len, y: -dy / len } }, shape);
}

/** Whether a world point lies inside a (rotated) node, grown by `margin`. */
export function hitsNode(n: CanvasNode, p: Point, margin = 0): boolean {
  const c = center(n);
  const local = rotate({ x: p.x - c.x, y: p.y - c.y }, -n.rotation);
  return Math.abs(local.x) <= n.w / 2 + margin && Math.abs(local.y) <= n.h / 2 + margin;
}

/** Whether a path passes through a rectangle: a sample inside it, or a segment between samples crossing it. */
export function pathHitsRect(path: LinkPath, r: Rect): boolean {
  const inside = (p: Point) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  const pts = path.samples;
  if (pts.some(inside)) return true;
  for (let i = 1; i < pts.length; i++) if (segmentHitsRect(pts[i - 1], pts[i], r)) return true;
  return false;
}

/** Liang–Barsky clipping: does the segment a→b touch the rectangle? */
function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}
