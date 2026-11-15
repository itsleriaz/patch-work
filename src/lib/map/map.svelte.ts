import { camera, clearSelection, doc, history, markFresh, selectedNodes, selectOnly } from "../app.svelte";
import { grow, placeView, toLocal, unite } from "../canvas/viewbox";
import type { Point } from "../doc/geometry";
import type { Op } from "../doc/ops.svelte";
import type { CanvasNode, Rect } from "../doc/types";
import { joinOps } from "../frame/frames.svelte";
import { play } from "../juice/sound";
import { settings } from "../settings.svelte";
import { stampDef } from "./stamps";
import {
  cellBounds,
  cellLine,
  cellSet,
  doorCovers,
  edgeKey,
  edgeRun,
  encodeCells,
  key,
  floorBeside,
  labelSpot,
  liveDoors,
  liveLabels,
  liveWalls,
  encodePath,
  encodeTris,
  groundBox,
  halfBlock,
  OPPOSITE,
  triMap,
  nearPath,
  pathBox,
  stampAt,
  stampBox,
  textBox,
  MARGIN,
  mapData,
  MAP_STYLES,
  PER_CELL,
  UNIT,
  unitEdges,
  nearestEdge,
  nextNumber,
  sameEdge,
  type DoorKind,
  type Edge,
  type Corner,
  type GroundStroke,
  type MapStyle,
  type MapPath,
  type MapText,
  type PathColor,
  type PathStyle,
  type Stamp,
  type MapData,
} from "./model";

/**
 * Editing maps. Like draw mode: while a map is being edited, the pointer paints on it instead of
 * selecting (Space and middle drag still pan). Room drags a rectangle of floor (Alt: cuts one out),
 * Brush paints cells, Erase removes them, Wall builds (or removes) interior walls along grid lines,
 * Door cycles a door on the nearest edge (door, locked, secret, none), Number places or removes a
 * room number, Text places, edits and moves free text, Stamp places symbols (click one to turn
 * it, drag to move it, Alt+click to remove it), Path draws routes over the map (Shift: through cell
 * centers; click one to change its style, Alt+click to remove it), Diagonal cuts cells corner to
 * corner (diagonal walls), Exterior paints terrain and roads around the dungeon (Alt:
 * erases). Each drag or click is one undo step.
 */

export type MapTool = "room" | "brush" | "erase" | "wall" | "door" | "number" | "text" | "stamp" | "path" | "diagonal" | "exterior";

type Cell = [number, number];

class MapUi {
  /** The map being edited. */
  editing = $state<string | null>(null);
  tool = $state<MapTool>("room");
  /**
   * What a drag would leave, shown live: the cells, the room rectangle being dragged, the walls,
   * and the run of edges a wall drag covers.
   */
  preview = $state.raw<{ nodeId: string; cells: string; tris?: string; rect: Rect | null; walls?: Edge[]; run?: Edge[]; removing?: boolean; texts?: MapText[]; stamps?: Stamp[]; paths?: MapPath[]; ground?: GroundStroke[] } | null>(null);
  /** A text label being typed into: a new one (not in the map yet) or an existing one. */
  textEdit = $state<{ nodeId: string; id: string; x: number; y: number; text: string; isNew: boolean } | null>(null);
  /** The cell (or, for walls and doors, the edge) under the pointer. */
  hover = $state.raw<{ cell: Cell; size: number; edge: Edge & { len: number }; corner: Corner } | null>(null);
}
export const mapUi = new MapUi();

export const isMap = (n: CanvasNode | undefined): boolean => n?.kind === "map";

export function enterMap(id: string) {
  mapUi.editing = id;
  mapUi.preview = mapUi.hover = null;
  clearSelection();
  play("toggleOn", { volume: 0.5 });
}

export function exitMap() {
  const id = mapUi.editing;
  if (!id) return;
  finishText(true);
  mapUi.editing = null;
  mapUi.preview = mapUi.hover = null;
  gesture = wallDrag = textDrag = stampDrag = pathDrag = diagDrag = groundDrag = null;
  if (doc.nodes[id]) selectOnly([id]);
  play("toggleOff", { volume: 0.5 });
}

export function setMapTool(tool: MapTool) {
  mapUi.tool = tool;
  play("tap", { volume: 0.4 });
}

/** A new map with a room in it, being edited. */
export function createMap(at: Point) {
  // A 6×4 room (in full cells; coordinates are half cells).
  const room = { w: 6 * PER_CELL, h: 4 * PER_CELL };
  const cells: string[] = [];
  for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) cells.push(key(x, y));
  const view = grow({ x: 0, y: 0, ...room }, MARGIN);
  const node: CanvasNode = {
    id: crypto.randomUUID(),
    kind: "map",
    assetId: null,
    x: Math.round(at.x - (view.w * UNIT) / 2),
    y: Math.round(at.y - (view.h * UNIT) / 2),
    w: view.w * UNIT,
    h: view.h * UNIT,
    rotation: 0,
    z: doc.maxZ() + 1,
    data: { style: "oldschool", unit: 2, view, cells: encodeCells(cells), tris: "", walls: [], doors: [], labels: [], texts: [], stamps: [], paths: [], ground: [] } satisfies MapData,
  };
  history.run("Add map", [{ type: "addNodes", nodes: [node] }, ...joinOps([node], at)]);
  markFresh([node.id]);
  mapUi.tool = "room";
  enterMap(node.id);
}

// ---------------------------------------------------------------- editing

function edited(): CanvasNode | undefined {
  const n = mapUi.editing ? doc.nodes[mapUi.editing] : undefined;
  return isMap(n) ? n : undefined;
}

/** A world point in the map's units (half cells, fractional). */
const cellPoint = (n: CanvasNode, p: Point) => toLocal(n, mapData(n.data).view, p);
/** Units per painted cell: 2 painting full cells, 1 half cells (the map bar's grid size). */
const step = () => (settings.mapGrid === "half" ? 1 : PER_CELL);
/** The painted cell (its top-left unit) under a point. */
const cellOf = (q: Point, s = step()): Cell => [Math.floor(q.x / s) * s, Math.floor(q.y / s) * s];
/** The units of the painted cell at `c`. */
function block([x, y]: Cell, s = step()): string[] {
  const out: string[] = [];
  for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) out.push(key(x + dx, y + dy));
  return out;
}

export function toggleMapGrid() {
  settings.mapGrid = settings.mapGrid === "half" ? "full" : "half";
  play("tap", { volume: 0.4, pitch: settings.mapGrid === "half" ? 1.2 : 0.95 });
}

/** Stores new map content as one step: walls, doors and numbers left without floor go, the box fits the floor. */
function commit(n: CanvasNode, label: string, next: Partial<MapData>) {
  const d = mapData($state.snapshot(n.data));
  const merged: MapData = { ...d, ...next };
  const set = cellSet(merged.cells);
  // A half cell under full floor is full.
  const tris = triMap(merged.tris);
  if ([...tris.keys()].some((k) => set.has(k))) merged.tris = encodeTris(new Map([...tris].filter(([k]) => !set.has(k))));
  const halves = triMap(merged.tris);
  merged.walls = liveWalls(merged.walls, set, halves);
  merged.doors = liveDoors(merged.doors, set, halves);
  merged.labels = liveLabels(merged.labels, set, halves);
  // The box takes in the floor and any text labels (which can sit outside it).
  const boxes = [cellBounds(new Set([...set, ...triMap(merged.tris).keys()])), ...merged.texts.map(textBox), ...merged.stamps.map(stampBox), ...merged.paths.map(pathBox), ...merged.ground.filter((g) => g.kind !== "erase").map(groundBox)].filter((r): r is Rect => !!r);
  const b = boxes.length ? boxes.reduce(unite) : null;
  // An emptied map keeps its place and size.
  merged.view = b ? grow(b, MARGIN) : d.view;
  if (JSON.stringify(merged) === JSON.stringify(d)) return false;
  const ops: Op[] = [{ type: "updateNodes", changes: [{ id: n.id, props: { ...placeView(n, d.view, merged.view), data: merged } }] }];
  history.run(label, ops);
  return true;
}

/** A room, brush or erase drag; `cleared`: units erased or cut out (half cells there go too). */
let gesture: { tool: MapTool; start: Cell; last: Cell; cells: Set<string>; cleared: Set<string>; tris: string; cut: boolean; step: number } | null = null;

/** The rectangle of units from cell a to cell b (both included), cells `s` units wide. */
function rectOf(a: Cell, b: Cell, s: number): Rect {
  const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
  return { x, y, w: Math.abs(b[0] - a[0]) + s, h: Math.abs(b[1] - a[1]) + s };
}

/** The cells a room drag would leave: the cells before it, plus (or minus, cutting) the rectangle. */
function roomPreview(g: NonNullable<typeof gesture>, to: Cell) {
  const cells = new Set(g.cells);
  const rect = rectOf(g.start, to, g.step);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (g.cut) {
        cells.delete(key(x, y));
        g.cleared.add(key(x, y));
      } else cells.add(key(x, y));
    }
  }
  return { cells, rect };
}

/** Half cells left after a drag: those under erased or cut-out units go. */
function keptTris(g: NonNullable<typeof gesture>): string {
  const tris = triMap(g.tris);
  return g.cleared.size && [...tris.keys()].some((k) => g.cleared.has(k)) ? encodeTris(new Map([...tris].filter(([k]) => !g.cleared.has(k)))) : g.tris;
}

function showPreview(n: CanvasNode, cells: Set<string>, rect: Rect | null) {
  mapUi.preview = { nodeId: n.id, cells: encodeCells(cells), tris: gesture ? keptTris(gesture) : undefined, rect };
}

export function mapDown(p: Point, e: PointerEvent) {
  const n = edited();
  if (!n) return;
  const d = mapData(n.data);
  const q = cellPoint(n, p);
  const c = cellOf(q);
  const tool = mapUi.tool;

  if (tool === "door") return toggleDoor(n, d, nearestEdge(q.x, q.y, step()));
  if (tool === "number") return toggleNumber(n, d, c);
  if (tool === "wall") return startWall(n, d, q, e);
  if (tool === "text") return startText(n, d, q);
  if (tool === "stamp") return startStamp(n, d, q, e);
  if (tool === "path") return startPath(n, d, q, e);
  if (tool === "diagonal") return startDiag(n, d, q);
  if (tool === "exterior") return startGround(n, d, q, e);

  gesture = { tool, start: c, last: c, cells: new Set(cellSet(d.cells)), cleared: new Set(), tris: d.tris, cut: tool === "room" && e.altKey, step: step() };
  if (tool === "room") {
    const r = roomPreview(gesture, c);
    showPreview(n, r.cells, r.rect);
  } else {
    paintLine(gesture, c, c);
    showPreview(n, gesture.cells, null);
  }
  play("tap", { volume: 0.3, pitch: tool === "erase" ? 0.85 : 1.1 });
}

function paintLine(g: NonNullable<typeof gesture>, from: Cell, to: Cell) {
  const s = g.step;
  for (const [x, y] of cellLine([from[0] / s, from[1] / s], [to[0] / s, to[1] / s])) {
    for (const k of block([x * s, y * s], s)) {
      if (g.tool === "erase") {
        g.cells.delete(k);
        g.cleared.add(k);
      } else g.cells.add(k);
    }
  }
}

export function mapMove(p: Point) {
  const n = edited();
  if (n && wallDrag) return moveWall(n, cellPoint(n, p));
  if (n && textDrag) return moveText(n, cellPoint(n, p));
  if (n && stampDrag) return moveStamp(n, cellPoint(n, p));
  if (n && pathDrag) return movePath(n, cellPoint(n, p));
  if (n && diagDrag) return moveDiag(n, cellPoint(n, p));
  if (n && groundDrag) return moveGround(n, cellPoint(n, p));
  const g = gesture;
  if (!n || !g) return;
  const c = cellOf(cellPoint(n, p), g.step);
  if (c[0] === g.last[0] && c[1] === g.last[1]) return;
  if (g.tool === "room") {
    const r = roomPreview(g, c);
    showPreview(n, r.cells, r.rect);
  } else {
    paintLine(g, g.last, c);
    showPreview(n, g.cells, null);
  }
  g.last = c;
  play("tap", { volume: 0.15, pitch: 1.3, throttle: 40 });
}

export function mapUp() {
  if (wallDrag) return endWall();
  if (textDrag) return endText();
  if (stampDrag) return endStamp();
  if (pathDrag) return endPath();
  if (diagDrag) return endDiag();
  if (groundDrag) return endGround();
  const n = edited(), g = gesture;
  gesture = null;
  const preview = mapUi.preview;
  mapUi.preview = null;
  if (!n || !g || !preview) return;
  const label = g.tool === "room" ? (g.cut ? "Cut room" : "Add room") : g.tool === "erase" ? "Erase floor" : "Paint floor";
  if (commit(n, label, { cells: preview.cells, tris: keptTris(g) })) play("swipe", { volume: 0.35, pitch: g.tool === "erase" || g.cut ? 0.9 : 1.15 });
}

/** The pointer moved without a drag: which cell or edge a click would act on. */
export function mapHover(p: Point | null) {
  const n = edited();
  if (!n || !p) return void (mapUi.hover = null);
  const q = cellPoint(n, p);
  const s = step();
  const cell = cellOf(q, s);
  mapUi.hover = { cell, size: s, edge: nearestEdge(q.x, q.y, s), corner: cornerIn(q, cell, s) };
}

// ---------------------------------------------------------------- walls

/**
 * A wall drag: from the grid corner nearest where it started, along one grid line (the axis the
 * pointer has moved along most). If the first edge it covers is a wall (or Alt is held), it removes
 * walls instead. A click (no edge covered) toggles the edge nearest the pointer.
 */
let wallDrag: { start: Cell; edge: Edge & { len: number }; walls: Edge[]; alt: boolean; removing: boolean | null; moved: boolean; step: number } | null = null;

/** The grid corner nearest a point, on the painting grid. */
const corner = (q: Point, s: number): Cell => [Math.round(q.x / s) * s, Math.round(q.y / s) * s];

function startWall(n: CanvasNode, d: MapData, q: Point, e: PointerEvent) {
  const s = step();
  wallDrag = { start: corner(q, s), edge: nearestEdge(q.x, q.y, s), walls: d.walls, alt: e.altKey, removing: null, moved: false, step: s };
  mapUi.preview = { nodeId: n.id, cells: d.cells, rect: null, walls: d.walls, run: [], removing: e.altKey };
}

function moveWall(n: CanvasNode, q: Point) {
  const g = wallDrag!;
  const [cx, cy] = corner(q, g.step);
  const [sx, sy] = g.start;
  const end: Cell = Math.abs(cx - sx) >= Math.abs(cy - sy) ? [cx, sy] : [sx, cy];
  const run = edgeRun(g.start, end);
  if (run.length) g.moved = true;
  // Adding or removing is decided by the first edge the drag covers.
  if (g.removing === null && run.length) g.removing = g.alt || g.walls.some((w) => sameEdge(w, run[0]));
  const keys = new Set(run.map(edgeKey));
  const kept = g.walls.filter((w) => !keys.has(edgeKey(w)));
  const walls = g.removing ? kept : [...kept, ...run];
  const prev = mapUi.preview;
  if (prev?.run?.length !== run.length) play("tap", { volume: 0.15, pitch: 1.3, throttle: 40 });
  mapUi.preview = { nodeId: n.id, cells: mapData(n.data).cells, rect: null, walls, run, removing: !!g.removing };
}

function endWall() {
  const n = edited(), g = wallDrag;
  wallDrag = null;
  const preview = mapUi.preview;
  mapUi.preview = null;
  if (!n || !g) return;
  const d = mapData(n.data);
  if (!g.moved) {
    // A click: one edge (a full cell's or a half's) on or off; only between floor (elsewhere there's
    // a wall already, or no floor).
    const set = cellSet(d.cells), halves = triMap(d.tris);
    const edges = unitEdges(g.edge).filter((u) => floorBeside(u, set, halves).every(Boolean));
    if (!edges.length) return play("denied", { volume: 0.4 });
    const keys = new Set(edges.map(edgeKey));
    const removing = g.alt || edges.every((u) => d.walls.some((w) => sameEdge(w, u)));
    const kept = d.walls.filter((w) => !keys.has(edgeKey(w)));
    const walls = removing ? kept : [...kept, ...edges];
    commit(n, removing ? "Remove wall" : "Add wall", { walls });
    return play(removing ? "vanish" : "button", { volume: 0.45 });
  }
  if (preview?.walls && commit(n, g.removing ? "Remove walls" : "Add wall", { walls: preview.walls })) {
    play("swipe", { volume: 0.35, pitch: g.removing ? 0.9 : 1.15 });
  }
}

// ---------------------------------------------------------------- text labels

/** A press on a text label: a drag moves it, a click edits it. */
let textDrag: { id: string; from: Point; x: number; y: number; moved: boolean } | null = null;

function startText(n: CanvasNode, d: MapData, q: Point) {
  // A click while typing just finishes the label.
  if (mapUi.textEdit) return finishText(true);
  const hit = [...d.texts].reverse().find((t) => {
    const r = textBox(t);
    return q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h;
  });
  if (hit) {
    textDrag = { id: hit.id, from: q, x: hit.x, y: hit.y, moved: false };
    return;
  }
  // Somewhere else: a new label, typed in place (on the half-cell grid, so labels line up).
  mapUi.textEdit = { nodeId: n.id, id: crypto.randomUUID(), x: Math.round(q.x), y: Math.round(q.y), text: "", isNew: true };
  play("tap", { volume: 0.4, pitch: 1.2 });
}

function moveText(n: CanvasNode, q: Point) {
  const g = textDrag!;
  const dx = Math.round(q.x - g.from.x), dy = Math.round(q.y - g.from.y);
  if (!dx && !dy && !g.moved) return;
  g.moved = true;
  const d = mapData(n.data);
  const texts = d.texts.map((t) => (t.id === g.id ? { ...t, x: g.x + dx, y: g.y + dy } : t));
  mapUi.preview = { nodeId: n.id, cells: d.cells, rect: null, texts };
}

function endText() {
  const n = edited(), g = textDrag;
  textDrag = null;
  const preview = mapUi.preview;
  mapUi.preview = null;
  if (!n || !g) return;
  if (g.moved && preview?.texts) {
    if (commit(n, "Move label", { texts: preview.texts })) play("button", { volume: 0.4 });
    return;
  }
  // A click: edit it.
  const t = mapData(n.data).texts.find((t) => t.id === g.id);
  if (t) mapUi.textEdit = { nodeId: n.id, id: t.id, x: t.x, y: t.y, text: t.text, isNew: false };
}

/** Ends typing a label: saved (a new one added, an emptied one removed) or dropped. */
export function finishText(save: boolean) {
  const e = mapUi.textEdit;
  if (!e) return;
  mapUi.textEdit = null;
  const n = doc.nodes[e.nodeId];
  if (!isMap(n) || !save) return;
  const d = mapData(n.data);
  const text = e.text.trim();
  if (e.isNew) {
    if (text) commit(n, "Add label", { texts: [...d.texts, { id: e.id, x: e.x, y: e.y, text }] });
    return;
  }
  const texts = text ? d.texts.map((t) => (t.id === e.id ? { ...t, text } : t)) : d.texts.filter((t) => t.id !== e.id);
  commit(n, text ? "Edit label" : "Remove label", { texts });
}

// ---------------------------------------------------------------- stamps

/** A press on a stamp: a drag moves it (cell by cell), a click turns it a quarter. */
let stampDrag: { id: string; from: Point; moved: boolean } | null = null;

/** The middle of the painted cell under a point: where a stamp of the grid's size goes. */
function cellCenter(q: Point, s = step()) {
  const [x, y] = cellOf(q, s);
  return { x: x + s / 2, y: y + s / 2, size: s };
}

function startStamp(n: CanvasNode, d: MapData, q: Point, e: PointerEvent) {
  const hit = stampAt(d.stamps, q.x, q.y);
  if (hit && e.altKey) {
    commit(n, "Remove stamp", { stamps: d.stamps.filter((s) => s !== hit) });
    return play("vanish", { volume: 0.45 });
  }
  if (hit) {
    stampDrag = { id: hit.id, from: q, moved: false };
    return;
  }
  const kind = settings.mapStamp;
  if (!stampDef(kind)) return play("denied", { volume: 0.4 });
  const at = cellCenter(q);
  commit(n, "Add stamp", { stamps: [...d.stamps, { id: crypto.randomUUID(), kind, ...at, rot: 0 }] });
  play("tap", { volume: 0.5, pitch: 1.15 });
}

function moveStamp(n: CanvasNode, q: Point) {
  const g = stampDrag!;
  const d = mapData(n.data);
  const s = d.stamps.find((x) => x.id === g.id);
  if (!s) return;
  // Snapped to the cells of the stamp's own size, so a full stamp stays on full cells.
  const at = cellCenter(q, s.size >= PER_CELL ? PER_CELL : 1);
  if (!g.moved && at.x === s.x && at.y === s.y) return;
  g.moved = true;
  mapUi.preview = { nodeId: n.id, cells: d.cells, rect: null, stamps: d.stamps.map((x) => (x.id === g.id ? { ...x, x: at.x, y: at.y } : x)) };
}

function endStamp() {
  const n = edited(), g = stampDrag;
  stampDrag = null;
  const preview = mapUi.preview;
  mapUi.preview = null;
  if (!n || !g) return;
  if (g.moved && preview?.stamps) {
    if (commit(n, "Move stamp", { stamps: preview.stamps })) play("button", { volume: 0.4 });
    return;
  }
  // A click: a quarter turn (stairs point the way up).
  const d = mapData(n.data);
  commit(n, "Turn stamp", { stamps: d.stamps.map((s) => (s.id === g.id ? { ...s, rot: (s.rot + 90) % 360 } : s)) });
  play("swipe", { volume: 0.3, pitch: 1.3 });
}

/** Picks the stamp the Stamp tool places. */
export function setStamp(kind: string) {
  settings.mapStamp = kind;
  mapUi.tool = "stamp";
  play("tap", { volume: 0.4, pitch: 1.1 });
}

// ---------------------------------------------------------------- exterior

/** Brush widths in units (small, medium, large): terrain, and roads. */
const GROUND_WIDTH = [2, 4, 8];
const ROAD_WIDTH = [1.5, 2.5, 4];

let groundDrag: {
  mode: "dirt" | "grass" | "water" | "road";
  erase: boolean;
  width: number;
  px: number;
  pts: [number, number][];
  stroke: string;
} | null = null;

function showGround(n: CanvasNode) {
  const g = groundDrag!, d = mapData(n.data);
  mapUi.preview = { nodeId: n.id, cells: d.cells, rect: null, ground: [...d.ground, groundStroke(g)] };
}

const groundStroke = (g: NonNullable<typeof groundDrag>): GroundStroke => ({
  id: g.stroke,
  kind: g.erase ? "erase" : (g.mode as GroundStroke["kind"]),
  width: g.width,
  points: encodePath(g.pts),
  px: g.px,
});

function startGround(n: CanvasNode, d: MapData, q: Point, e: PointerEvent) {
  const mode = settings.mapGround;
  const size = Math.max(0, Math.min(2, settings.mapGroundSize));
  groundDrag = {
    mode,
    erase: e.altKey,
    width: (mode === "road" ? ROAD_WIDTH : GROUND_WIDTH)[size],
    px: d.view.w / n.w / camera.zoom,
    pts: [[q.x, q.y]],
    stroke: crypto.randomUUID(),
  };
  showGround(n);
}

function moveGround(n: CanvasNode, q: Point) {
  const g = groundDrag!;
  const last = g.pts[g.pts.length - 1];
  const dist = Math.hypot(q.x - last[0], q.y - last[1]);
  if (dist < g.px) return;
  g.pts.push([q.x, q.y]);
  showGround(n);
}

function endGround() {
  const n = edited(), g = groundDrag;
  groundDrag = null;
  mapUi.preview = null;
  if (!n || !g) return;
  const d = mapData(n.data);
  const label = g.erase ? "Erase ground" : g.mode === "road" ? "Add road" : `Paint ${g.mode}`;
  if (commit(n, label, { ground: [...d.ground, groundStroke(g)] })) play("swipe", { volume: 0.3, pitch: g.erase ? 0.9 : 1.1 });
}

export function setGround(look: { mode?: typeof settings.mapGround; size?: number }) {
  if (look.mode) settings.mapGround = look.mode;
  if (look.size !== undefined) settings.mapGroundSize = look.size;
  play("tap", { volume: 0.4 });
}

// ---------------------------------------------------------------- diagonal walls

/** The corner of a painted cell nearest a point in it. */
function cornerIn(q: Point, [x, y]: Cell, s: number): Corner {
  const fx = (q.x - x) / s, fy = (q.y - y) / s;
  return `${fy < 0.5 ? "n" : "s"}${fx < 0.5 ? "w" : "e"}` as Corner;
}

/**
 * A diagonal drag. Its first cell decides what it does to each cell it passes over: a full cell
 * gets the corner cut off (the half opposite stays floor), an empty one gets that corner's half
 * filled in, a cut one is made whole again.
 */
let diagDrag: { mode: "cut" | "fill" | "whole"; corner: Corner; step: number; cells: Set<string>; tris: Map<string, Corner>; done: Set<string> } | null = null;

type BlockState = "full" | "empty" | "half" | "mixed";

function blockState(c: Cell, s: number, cells: Set<string>, tris: Map<string, Corner>): BlockState {
  const units = block(c, s);
  if (units.some((k) => tris.has(k))) return "half";
  const n = units.filter((k) => cells.has(k)).length;
  return n === units.length ? "full" : n === 0 ? "empty" : "mixed";
}

/** Applies the drag's change to one cell, if it suits it (see `diagDrag`). */
function applyDiag(g: NonNullable<typeof diagDrag>, c: Cell): boolean {
  const k = key(c[0], c[1]);
  if (g.done.has(k)) return false;
  const state = blockState(c, g.step, g.cells, g.tris);
  const wanted = g.mode === "cut" ? "full" : g.mode === "fill" ? "empty" : "half";
  if (state !== wanted && !(g.mode === "cut" && state === "mixed" && g.done.size === 0)) return false;
  g.done.add(k);
  if (g.mode === "whole") {
    for (const u of block(c, g.step)) {
      g.cells.add(u);
      g.tris.delete(u);
    }
    return true;
  }
  // Cutting keeps the half opposite the corner; filling adds the corner's half.
  const keep = g.mode === "cut" ? OPPOSITE[g.corner] : g.corner;
  const b = halfBlock(c, g.step, keep);
  for (const u of b.full) {
    g.cells.add(u);
    g.tris.delete(u);
  }
  for (const [u, corner] of b.half) {
    g.cells.delete(u);
    g.tris.set(u, corner);
  }
  for (const u of b.empty) {
    g.cells.delete(u);
    g.tris.delete(u);
  }
  return true;
}

function showDiag(n: CanvasNode) {
  const g = diagDrag!;
  mapUi.preview = { nodeId: n.id, cells: encodeCells(g.cells), tris: encodeTris(g.tris), rect: null };
}

function startDiag(n: CanvasNode, d: MapData, q: Point) {
  const s = step();
  const c = cellOf(q, s);
  const cells = new Set(cellSet(d.cells)), tris = new Map(triMap(d.tris));
  const state = blockState(c, s, cells, tris);
  const mode = state === "half" ? "whole" : state === "empty" ? "fill" : "cut";
  diagDrag = { mode, corner: cornerIn(q, c, s), step: s, cells, tris, done: new Set() };
  applyDiag(diagDrag, c);
  showDiag(n);
  play("tap", { volume: 0.35, pitch: 1.1 });
}

function moveDiag(n: CanvasNode, q: Point) {
  const g = diagDrag!;
  if (applyDiag(g, cellOf(q, g.step))) {
    showDiag(n);
    play("tap", { volume: 0.15, pitch: 1.3, throttle: 40 });
  }
}

function endDiag() {
  const n = edited(), g = diagDrag;
  diagDrag = null;
  mapUi.preview = null;
  if (!n || !g || !g.done.size) return;
  const label = g.mode === "whole" ? "Remove diagonal" : "Add diagonal";
  if (commit(n, label, { cells: encodeCells(g.cells), tris: encodeTris(g.tris) })) play("swipe", { volume: 0.35, pitch: 1.1 });
}

// ---------------------------------------------------------------- overlay paths

/** A path being drawn: its points (units), snapped through cell centers or freehand, and the path it started on. */
let pathDrag: { path: MapPath; pts: [number, number][]; on: MapPath | undefined; step: number } | null = null;

const PATH_STYLES: PathStyle[] = ["dashed", "dotted", "footprints"];

function startPath(n: CanvasNode, d: MapData, q: Point, e: PointerEvent) {
  const view = d.view;
  // Units per screen pixel: smoothing and hit tests are measured on screen.
  const px = view.w / n.w / camera.zoom;
  const on = [...d.paths].reverse().find((x) => nearPath(x, q.x, q.y, 8 * px));
  if (on && e.altKey) {
    commit(n, "Remove path", { paths: d.paths.filter((x) => x !== on) });
    return play("vanish", { volume: 0.45 });
  }
  const s = step();
  const snapped = e.shiftKey;
  const start = snapped ? cellCenter(q, s) : q;
  pathDrag = {
    path: { id: crypto.randomUUID(), style: settings.mapPathStyle, color: settings.mapPathColor, points: "", px, snapped: snapped || undefined },
    pts: [[start.x, start.y]],
    on,
    step: s,
  };
}

function movePath(n: CanvasNode, q: Point) {
  const g = pathDrag!;
  const last = g.pts[g.pts.length - 1];
  if (g.path.snapped) {
    const c = cellCenter(q, g.step);
    if (c.x === last[0] && c.y === last[1]) return;
    g.pts.push([c.x, c.y]);
  } else {
    // Closer than a screen pixel adds nothing.
    if (Math.hypot(q.x - last[0], q.y - last[1]) < g.path.px) return;
    g.pts.push([q.x, q.y]);
  }
  const d = mapData(n.data);
  mapUi.preview = { nodeId: n.id, cells: d.cells, rect: null, paths: [...d.paths, { ...g.path, points: encodePath(g.pts) }] };
}

function endPath() {
  const n = edited(), g = pathDrag;
  pathDrag = null;
  mapUi.preview = null;
  if (!n || !g) return;
  const d = mapData(n.data);
  const [x0, y0] = g.pts[0], [x1, y1] = g.pts[g.pts.length - 1];
  const long = g.pts.length > 1 && (g.path.snapped || g.pts.some(([x, y]) => Math.hypot(x - x0, y - y0) > 0.5) || Math.hypot(x1 - x0, y1 - y0) > 0.5);
  if (!long) {
    // A click on a path: its next style.
    if (!g.on) return;
    const on = g.on;
    const style = PATH_STYLES[(PATH_STYLES.indexOf(on.style) + 1) % PATH_STYLES.length];
    commit(n, "Change path", { paths: d.paths.map((x) => (x.id === on.id ? { ...x, style } : x)) });
    return play("tap", { volume: 0.45, pitch: 1.2 });
  }
  if (commit(n, "Add path", { paths: [...d.paths, { ...g.path, points: encodePath(g.pts) }] })) play("swipe", { volume: 0.35, pitch: 1.2 });
}

/** Sets the style or color new paths get. */
export function setPathLook(look: { style?: PathStyle; color?: PathColor }) {
  if (look.style) settings.mapPathStyle = look.style;
  if (look.color) settings.mapPathColor = look.color;
  play("tap", { volume: 0.4 });
}

const DOOR_CYCLE: (DoorKind | null)[] = ["door", "locked", "secret", null];

/** Cycles the door on an edge: none → door → locked → secret → none. Only edges touching floor take doors. */
function toggleDoor(n: CanvasNode, d: MapData, edge: Edge & { len: number }) {
  const set = cellSet(d.cells), halves = triMap(d.tris);
  const units = unitEdges(edge);
  if (!units.some((u) => floorBeside(u, set, halves).some(Boolean))) return play("denied", { volume: 0.4 });
  // A door already there (of either size) cycles; otherwise a new one, the size of the grid.
  const current = d.doors.find((x) => units.some((u) => doorCovers(x, u)));
  const next = DOOR_CYCLE[(DOOR_CYCLE.indexOf(current?.kind ?? null) + 1) % DOOR_CYCLE.length];
  const doors = d.doors.filter((x) => x !== current);
  if (next) doors.push(current ? { ...current, kind: next } : { x: edge.x, y: edge.y, side: edge.side, len: edge.len, kind: next });
  const label = !next ? "Remove door" : next === "door" ? "Add door" : next === "locked" ? "Lock door" : "Make door secret";
  commit(n, label, { doors });
  play(next ? "button" : "vanish", { volume: 0.45, pitch: next === "locked" ? 0.9 : next === "secret" ? 0.8 : 1 });
}

/** Places the next room number in the middle of a floor cell (full or half), or removes the one there. */
function toggleNumber(n: CanvasNode, d: MapData, c: Cell) {
  const s = step();
  const set = cellSet(d.cells), halves = triMap(d.tris);
  if (!block(c, s).some((k) => set.has(k) || halves.has(k))) return play("denied", { volume: 0.4 });
  const here = d.labels.find((l) => l.x >= c[0] && l.x < c[0] + s && l.y >= c[1] && l.y < c[1] + s);
  const spot = labelSpot(c, s, set, halves);
  const labels = here ? d.labels.filter((l) => l !== here) : [...d.labels, { x: spot[0], y: spot[1], n: nextNumber(d.labels) }];
  commit(n, here ? "Remove room number" : "Number room", { labels });
  play(here ? "vanish" : "tap", { volume: 0.45, pitch: 1.2 });
}


/** The map a style change is for: the one being edited, else the single selected map. */
export function styledMap(): CanvasNode | null {
  const n = mapUi.editing ? doc.nodes[mapUi.editing] : selectedNodes().length === 1 ? selectedNodes()[0] : null;
  return n && n.kind === "map" ? n : null;
}

/** Gives the map a look (one undo step). The data is untouched apart from `style`. */
export function setMapStyle(style: MapStyle) {
  const n = styledMap();
  if (!n || n.locked || mapData(n.data).style === style) return;
  history.run(`Map style: ${MAP_STYLES.find((s) => s.id === style)?.label}`, [{ type: "updateNodes", changes: [{ id: n.id, props: { data: { ...mapData($state.snapshot(n.data)), style } } }] }]);
  play("select", { volume: 0.4 });
}
