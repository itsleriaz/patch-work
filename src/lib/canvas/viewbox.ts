import { frameOf, rotate, type Point } from "../doc/geometry";
import type { CanvasNode, Rect } from "../doc/types";

/**
 * Nodes with their own coordinate space (drawings, maps): `view` is the rect of that space the
 * node shows, stretched to the node's box, so the content scales and rotates with the node. Adding
 * content outside it grows `view`, and `placeView` moves the box so nothing already there moves.
 */

/** World → the node's own units. */
export function toLocal(n: CanvasNode, view: Rect, p: Point): Point {
  const f = frameOf(n);
  const q = rotate({ x: p.x - f.cx, y: p.y - f.cy }, -n.rotation);
  return { x: view.x + ((q.x + n.w / 2) * view.w) / n.w, y: view.y + ((q.y + n.h / 2) * view.h) / n.h };
}

/** World units per unit of the node's own (the node's scale on the board). */
export const scaleOf = (n: CanvasNode, view: Rect) => Math.sqrt((n.w / view.w) * (n.h / view.h));

/** The node's geometry for a new `view`: the same units stay at the same place on the board. */
export function placeView(n: CanvasNode, view: Rect, next: Rect): Pick<CanvasNode, "x" | "y" | "w" | "h"> {
  const sx = n.w / view.w, sy = n.h / view.h;
  const w = next.w * sx, h = next.h * sy;
  // The new box's center, relative to the old center, in the node's (rotated) frame.
  const local = { x: (next.x - view.x) * sx + w / 2 - n.w / 2, y: (next.y - view.y) * sy + h / 2 - n.h / 2 };
  const f = frameOf(n);
  const d = rotate(local, n.rotation);
  return { x: f.cx + d.x - w / 2, y: f.cy + d.y - h / 2, w, h };
}

export const grow = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });

export function unite(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
