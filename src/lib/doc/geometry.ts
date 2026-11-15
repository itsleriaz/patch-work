import type { CanvasNode, Rect } from "./types";

export interface Point {
  x: number;
  y: number;
}

/** A possibly rotated rectangle described by its center. Rotation in degrees. */
export interface Frame {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

export const toRad = (deg: number) => (deg * Math.PI) / 180;
export const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Normalizes an angle to (-180, 180]. */
export function normalizeDeg(deg: number) {
  const d = ((deg % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

export function rotate(p: Point, deg: number): Point {
  const r = toRad(deg), c = Math.cos(r), s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function frameOf(n: CanvasNode): Frame {
  return { cx: n.x + n.w / 2, cy: n.y + n.h / 2, w: n.w, h: n.h, rotation: n.rotation };
}

/** Axis-aligned bounds of a (rotated) node. Nodes rotate about their center. */
export function aabb(n: CanvasNode): Rect {
  if (!n.rotation) return { x: n.x, y: n.y, w: n.w, h: n.h };
  const r = toRad(n.rotation);
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const w = n.w * c + n.h * s, h = n.w * s + n.h * c;
  return { x: n.x + n.w / 2 - w / 2, y: n.y + n.h / 2 - h / 2, w, h };
}

export function union(rects: Iterable<Rect>): Rect | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function bounds(nodes: Iterable<CanvasNode>): Rect | null {
  return union([...nodes].map(aabb));
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
