import { SvelteSet } from "svelte/reactivity";
import { camera, clearSelection, doc, history } from "../app.svelte";
import { aabb, intersects, type Point } from "../doc/geometry";
import { grow, placeView, scaleOf, toLocal, unite } from "../canvas/viewbox";
import type { Op } from "../doc/ops.svelte";
import type { CanvasNode, Rect } from "../doc/types";
import { joinOps } from "../frame/frames.svelte";
import { closeSearch, searchUi } from "../search/search.svelte";
import { play } from "../juice/sound";
import { isMac } from "../platform";
import { settings } from "../settings.svelte";
import { drawingData, encodePoints, MARGIN_PX, pointBounds, SIZES, strokeBounds, touchesStroke, type DrawingData, type InkColor, type InkTool, type Stroke, type Triple } from "./model";

/**
 * Draw mode. While it's on, dragging on the canvas draws (or erases) instead of selecting; panning
 * and zooming work as usual. Each stroke is one undo step. A stroke joins a drawing made in this
 * session (or the one draw mode was started on) when it comes near it, else it starts a new
 * drawing node on top of everything, so marking up a picture just works.
 */

export type DrawTool = InkTool | "eraser";

/** A stroke being drawn, in world units. */
export interface LiveStroke {
  tool: InkTool;
  color: InkColor;
  size: number;
  pressure: boolean;
  /** World units per screen pixel. */
  px: number;
  points: Triple[];
  /** Indices of points that end a straight segment (see `Stroke.straight`). */
  straight: number[];
  /** The straight segment being drawn (Shift held): its end, from the last point. */
  ruler: Triple | null;
}

class DrawUi {
  active = $state(false);
  /** The stroke being drawn; `version` bumps as points are added (the array is mutated in place). */
  live = $state.raw<LiveStroke | null>(null);
  version = $state(0);
  /** Strokes the eraser has passed over in this drag, as "nodeId:strokeId": hidden until it lets go. */
  erasing = new SvelteSet<string>();
  /** Where the pointer is over the canvas (viewport px), for the brush outline. */
  cursor = $state<Point | null>(null);
  /** The pen's eraser end is down: erase whatever the tool. */
  penEraser = $state(false);
}
export const drawUi = new DrawUi();

/** Drawings strokes may join: made in this session of draw mode, or the one it was started on. */
let session: string[] = [];

/** How close (screen px) a stroke must come to a session drawing to join it. */
const JOIN_PX = 120;

export const isDrawing = (n: CanvasNode | undefined): boolean => n?.kind === "drawing";

/** The tool in use: the eraser while the pen's eraser end is down. */
export const currentTool = (): DrawTool => (drawUi.penEraser ? "eraser" : settings.inkTool);

/** The current tool's brush size in screen px. */
export function brushPx(tool: DrawTool = currentTool()) {
  const sizes = SIZES[tool];
  const i = tool === "pen" ? settings.penSize : tool === "marker" ? settings.markerSize : settings.eraserSize;
  return sizes[Math.max(0, Math.min(sizes.length - 1, i))];
}

export function enterDraw(onto?: string) {
  if (drawUi.active && !onto) return;
  drawUi.active = true;
  session = onto ? [onto] : [];
  clearSelection();
  // The draw bar takes the find bar's place.
  if (searchUi.open) closeSearch();
  play("toggleOn", { volume: 0.5 });
}

export function exitDraw() {
  if (!drawUi.active) return;
  lastEnd = null;
  drawUi.active = false;
  drawUi.live = null;
  drawUi.erasing.clear();
  drawUi.cursor = null;
  session = [];
  play("toggleOff", { volume: 0.5 });
}

export const toggleDraw = (onto?: string) => (drawUi.active ? exitDraw() : enterDraw(onto));

export function setTool(tool: DrawTool) {
  settings.inkTool = tool;
  play("tap", { volume: 0.4 });
}

/** Steps the current tool's size (small, medium, large). */
export function stepSize(delta: number) {
  const tool = currentTool();
  const key = tool === "pen" ? "penSize" : tool === "marker" ? "markerSize" : "eraserSize";
  const next = Math.max(0, Math.min(SIZES[tool].length - 1, settings[key] + delta));
  if (next === settings[key]) return play("denied", { volume: 0.4 });
  settings[key] = next;
  play("tap", { volume: 0.4, pitch: delta > 0 ? 1.1 : 0.9 });
}

// ---------------------------------------------------------------- drawing

/** Pointer pressure: a pen's own, else a constant (perfect-freehand simulates it from speed). */
const pressureOf = (e: PointerEvent) => (e.pointerType === "pen" ? Math.max(0.05, e.pressure || 0.5) : 0.5);

// ---------------------------------------------------------------- straight lines

/** Straight lines snap to multiples of 15° from where they start (24 directions). */
const SNAP = Math.PI / 12;
/** Where the last stroke of this session ended (world): Shift+click draws a straight line on from it. */
let lastEnd: Triple | null = null;
/** The pointer's last position (world) and pressure, for redrawing the straight line when only a key changes. */
let pointer: Triple | null = null;
/** Snapping is off while Ctrl (⌘ on macOS) is held. */
let free = false;

const modHeld = (e: { ctrlKey: boolean; metaKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey);

/** The straight line's end: toward the pointer, along the nearest 15° direction unless snapping is off. */
function rulerEnd(anchor: Triple, p: Triple): Triple {
  if (free) return p;
  const dx = p[0] - anchor[0], dy = p[1] - anchor[1];
  const a = Math.round(Math.atan2(dy, dx) / SNAP) * SNAP;
  const len = Math.max(0, dx * Math.cos(a) + dy * Math.sin(a));
  return [anchor[0] + Math.cos(a) * len, anchor[1] + Math.sin(a) * len, p[2]];
}

function aim(live: LiveStroke) {
  if (!pointer) return;
  live.ruler = rulerEnd(live.points[live.points.length - 1], pointer);
  drawUi.version++;
}

/** Ends the straight segment: its end becomes a point, and drawing goes on freehand from there. */
function commitRuler(live: LiveStroke) {
  const end = live.ruler;
  live.ruler = null;
  const last = live.points[live.points.length - 1];
  if (!end || Math.hypot(end[0] - last[0], end[1] - last[1]) * camera.zoom < 1) return;
  live.points.push(end);
  live.straight.push(live.points.length - 1);
  drawUi.version++;
}

/** Shift and Ctrl/⌘ pressed or let go while drawing: start or end the straight line, snap or not. */
export function drawModifiers(e: KeyboardEvent) {
  const live = drawUi.live;
  if (!live) return;
  free = modHeld(e);
  if (e.shiftKey && !live.ruler) aim(live);
  else if (!e.shiftKey && live.ruler) commitRuler(live);
  else if (live.ruler) aim(live);
}

export function startStroke(p: Point, e: PointerEvent) {
  const tool = settings.inkTool === "eraser" ? "pen" : settings.inkTool;
  const here: Triple = [p.x, p.y, pressureOf(e)];
  pointer = here;
  free = modHeld(e);
  // Shift+click after a stroke: a straight line on from where it ended.
  const from = e.shiftKey && lastEnd ? lastEnd : here;
  const live: LiveStroke = {
    tool,
    color: settings.inkColor,
    size: brushPx(tool) / camera.zoom,
    pressure: e.pointerType === "pen",
    px: 1 / camera.zoom,
    points: [from],
    straight: [],
    ruler: null,
  };
  if (e.shiftKey) live.ruler = rulerEnd(from, here);
  drawUi.live = live;
  drawUi.version++;
}

export function extendStroke(p: Point, e: PointerEvent) {
  const live = drawUi.live;
  if (!live) return;
  pointer = [p.x, p.y, pressureOf(e)];
  free = modHeld(e);
  if (e.shiftKey) return aim(live);
  if (live.ruler) commitRuler(live);
  const last = live.points[live.points.length - 1];
  // Points closer than a screen pixel add nothing but weight.
  if (Math.hypot(p.x - last[0], p.y - last[1]) * camera.zoom < 1) return;
  live.points.push([p.x, p.y, pressureOf(e)]);
  drawUi.version++;
}

/** The session drawing this stroke (world bounds) comes near, newest first. */
function joinTarget(bounds: Rect): CanvasNode | undefined {
  const reach = JOIN_PX / camera.zoom;
  for (let i = session.length - 1; i >= 0; i--) {
    const n = doc.nodes[session[i]];
    if (isDrawing(n) && intersects(grow(aabb(n), reach), bounds)) return n;
  }
}

/** Ends the stroke: adds it to a nearby drawing of this session, or to a new drawing node. */
export function endStroke() {
  const live = drawUi.live;
  drawUi.live = null;
  if (!live) return;
  if (live.ruler) commitRuler(live);
  lastEnd = live.points[live.points.length - 1];
  const straight = live.straight.length ? [...live.straight] : undefined;
  const id = crypto.randomUUID();
  const world = { tool: live.tool, color: live.color, size: live.size, pressure: live.pressure || undefined, px: live.px, straight };
  const margin = MARGIN_PX / camera.zoom;
  const wb = pointBounds([[live.points, live.size]])!;

  const target = joinTarget(wb);
  if (target) {
    const d = drawingData($state.snapshot(target.data));
    const k = scaleOf(target, d.view);
    const points = live.points.map(([x, y, pr]): Triple => {
      const q = toLocal(target, d.view, { x, y });
      return [q.x, q.y, pr];
    });
    const stroke: Stroke = { id, ...world, size: live.size / k, px: live.px / k, points: encodePoints(points) };
    const view = unite(d.view, grow(strokeBounds([stroke])!, margin / k));
    const data: DrawingData = { view, strokes: [...d.strokes, stroke] };
    history.run("Draw", [{ type: "updateNodes", changes: [{ id: target.id, props: { ...placeView(target, d.view, view), data } }] }]);
  } else {
    // A new drawing: its units are world units, its view the stroke's bounds.
    const view = grow(wb, margin);
    const node: CanvasNode = {
      id: crypto.randomUUID(),
      kind: "drawing",
      assetId: null,
      ...view,
      rotation: 0,
      z: doc.maxZ() + 1,
      data: { view, strokes: [{ id, ...world, points: encodePoints(live.points) }] } satisfies DrawingData,
    };
    const ops: Op[] = [{ type: "addNodes", nodes: [node] }, ...joinOps([node], { x: view.x + view.w / 2, y: view.y + view.h / 2 })];
    history.run("Add drawing", ops);
    session.push(node.id);
  }
  play("tap", { volume: 0.25, pitch: 1.2, throttle: 60 });
}

// ---------------------------------------------------------------- erasing

/** Last eraser position (world), so a fast drag erases along the whole way, not just where events land. */
let eraserFrom: Point | null = null;

export function startErase(p: Point) {
  drawUi.erasing.clear();
  eraserFrom = null;
  eraseAt(p);
}

/** Marks the strokes the eraser touches on its way from the last position to `p`. */
export function eraseAt(p: Point) {
  const r = brushPx("eraser") / 2 / camera.zoom;
  const from = eraserFrom ?? p;
  eraserFrom = p;
  const steps = Math.max(1, Math.ceil(Math.hypot(p.x - from.x, p.y - from.y) / (r / 2)));
  const sweep: Rect = grow({ x: Math.min(from.x, p.x), y: Math.min(from.y, p.y), w: Math.abs(p.x - from.x), h: Math.abs(p.y - from.y) }, r);
  for (const n of doc.nodeList) {
    if (!isDrawing(n) || !intersects(aabb(n), sweep)) continue;
    const d = drawingData(n.data);
    const k = scaleOf(n, d.view);
    for (let i = 0; i <= steps; i++) {
      const at = toLocal(n, d.view, { x: from.x + ((p.x - from.x) * i) / steps, y: from.y + ((p.y - from.y) * i) / steps });
      for (const s of d.strokes) {
        const key = `${n.id}:${s.id}`;
        if (!drawUi.erasing.has(key) && touchesStroke(s, at.x, at.y, r / k)) {
          drawUi.erasing.add(key);
          play("tap", { volume: 0.2, pitch: 0.8, throttle: 50 });
        }
      }
    }
  }
}

/** Removes the strokes erased in this drag as one step; drawings left empty go. Their boxes shrink to what's left. */
export function endErase() {
  eraserFrom = null;
  const byNode = new Map<string, Set<string>>();
  for (const key of drawUi.erasing) {
    const [nodeId, strokeId] = key.split(":");
    byNode.set(nodeId, (byNode.get(nodeId) ?? new Set()).add(strokeId));
  }
  drawUi.erasing.clear();
  if (!byNode.size) return;

  const ops: Op[] = [];
  const removed: string[] = [];
  let count = 0;
  for (const [nodeId, ids] of byNode) {
    const n = doc.nodes[nodeId];
    if (!n) continue;
    const d = drawingData($state.snapshot(n.data));
    const strokes = d.strokes.filter((s) => !ids.has(s.id));
    count += d.strokes.length - strokes.length;
    if (!strokes.length) {
      removed.push(nodeId);
      continue;
    }
    const margin = MARGIN_PX / camera.zoom / scaleOf(n, d.view);
    const view = grow(strokeBounds(strokes)!, margin);
    ops.push({ type: "updateNodes", changes: [{ id: nodeId, props: { ...placeView(n, d.view, view), data: { view, strokes } } }] });
  }
  if (removed.length) ops.push({ type: "removeNodes", ids: removed });
  history.run(count === 1 ? "Erase stroke" : `Erase ${count} strokes`, ops);
  play("swipe", { volume: 0.4, pitch: 1.2 });
}

/** Whether `p` (world) is within `margin` of one of a drawing's strokes. */
export function nearStrokes(n: CanvasNode, p: Point, margin: number): boolean {
  const d = drawingData(n.data);
  const q = toLocal(n, d.view, p);
  const r = margin / scaleOf(n, d.view);
  return d.strokes.some((s) => touchesStroke(s, q.x, q.y, r));
}
