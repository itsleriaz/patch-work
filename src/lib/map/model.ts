import type { Rect } from "../doc/types";
import { outline as strokeOutline, smoothPoints } from "../drawing/model";

/**
 * A map node: a square grid where floor is painted and walls follow automatically along every
 * edge between floor and nothing (Dungeon Scrawl's idea). Interior walls (dividing floor) and
 * doors sit on edges, room numbers and text labels at points.
 *
 * **Coordinates are half cells ("units")**, so painting can be at the full cell size (2×2 units)
 * or at half of it; a full cell is what the floor grid shows. `view` is the rect of units the node
 * shows (the painted area plus a margin for the hatching), stretched to the node like a drawing's.
 * Maps from before half cells (no `unit` field) are converted when read (`mapData`).
 *
 * Cells are one string ("x,y x,y …"): undo steps hold the whole `data`, and a string is shared
 * between them where an array would be copied.
 */

export type DoorKind = "door" | "locked" | "secret";

// Type aliases, not interfaces: node data is typed Record<string, unknown>.
/** The north (`n`) or west (`w`) edge of unit (x, y); other edges are named from the neighbor. */
export type Edge = { x: number; y: number; side: "n" | "w" };
/** A door from its edge on, `len` units long along it (2: a full cell, 1: half). */
export type Door = Edge & { kind: DoorKind; len?: number };
/** A room number, centered on (x, y) in units. */
export type RoomLabel = { x: number; y: number; n: number };
/** Free text on the map, centered on (x, y) in units. */
export type MapText = { id: string; x: number; y: number; text: string };
/** A stamp (stamps.ts): a symbol centered on (x, y), `size` units square, turned `rot` degrees (0, 90, 180, 270). */
export type Stamp = { id: string; kind: string; x: number; y: number; size: number; rot: number };
export type PathStyle = "dashed" | "dotted" | "footprints";
export type PathColor = "ink" | "red";
/**
 * An overlay path: a route drawn over the map. `points` "x y x y …" in units, as drawn; smoothed
 * like a drawing's stroke when shown (`px`: units per screen pixel when drawn), unless `snapped`
 * (through cell centers, shown as straight segments).
 */
export type MapPath = { id: string; style: PathStyle; color: PathColor; points: string; px: number; snapped?: boolean };
/** Exterior ground, painted in order (later strokes over earlier ones): terrain, roads, or erasing them. */
export type GroundKind = "dirt" | "grass" | "water" | "road" | "erase";
export type GroundStroke = { id: string; kind: GroundKind; width: number; points: string; px: number };

/** A map's look (the whole map): see MapContent's style rules. */
export type MapStyle = "oldschool" | "blueprint" | "parchment" | "cave";
export const MAP_STYLES: { id: MapStyle; label: string }[] = [
  { id: "oldschool", label: "Old-school" },
  { id: "blueprint", label: "Blueprint" },
  { id: "parchment", label: "Parchment" },
  { id: "cave", label: "Cave" },
];

export type MapData = {
  /** The look; maps without it are old-school. Old-school follows the app's theme, the others keep their own colors. */
  style: MapStyle;
  /** Always 2: coordinates are half cells. Maps without it are from before, in whole cells. */
  unit: 2;
  view: Rect;
  cells: string;
  /** Half cells (diagonal walls): "x,y,corner x,y,corner …" (see `Corner`). */
  tris: string;
  /** Interior walls: edges with floor on both sides (outer walls are drawn on their own). */
  walls: Edge[];
  doors: Door[];
  labels: RoomLabel[];
  texts: MapText[];
  stamps: Stamp[];
  paths: MapPath[];
  /** Exterior terrain and roads (see `GroundStroke`). */
  ground: GroundStroke[];
};

/** World units per full cell for a new map: twice the board grid, so maps line up with everything else. */
export const CELL = 40;
/** Units per full cell (coordinates are half cells), and world units per unit for a new map. */
export const PER_CELL = 2;
export const UNIT = CELL / PER_CELL;
/** Units of space around the floor for the hatching outside the walls (a full cell). */
export const MARGIN = 2;

/** Converted maps from before half cells, by their data object (they convert again when written). */
const converted = new WeakMap<object, MapData>();

export function mapData(data: unknown): MapData {
  const d = (data ?? {}) as Partial<MapData> & { unit?: number };
  const v = d.view;
  const read: MapData = {
    style: MAP_STYLES.some((s) => s.id === d.style) ? (d.style as MapStyle) : "oldschool",
    unit: 2,
    view: v && v.w > 0 && v.h > 0 ? v : { x: 0, y: 0, w: 1, h: 1 },
    cells: typeof d.cells === "string" ? d.cells : "",
    tris: typeof d.tris === "string" ? d.tris : "",
    walls: Array.isArray(d.walls) ? d.walls : [],
    doors: Array.isArray(d.doors) ? d.doors : [],
    labels: Array.isArray(d.labels) ? d.labels : [],
    texts: Array.isArray(d.texts) ? d.texts : [],
    stamps: Array.isArray(d.stamps) ? d.stamps : [],
    paths: Array.isArray(d.paths) ? d.paths : [],
    // Maps from 2026-10-11 may also hold `scatter` (rocks and trees, dropped since): ignored.
    ground: Array.isArray(d.ground) ? d.ground : [],
  };
  if (d.unit === 2 || !data || typeof data !== "object") return read;
  let c = converted.get(data);
  if (!c) {
    c = fromWholeCells(read);
    converted.set(data, c);
  }
  return c;
}

/** A map from before half cells, in units: each cell 2×2, each edge two, doors a full cell wide. */
function fromWholeCells(d: MapData): MapData {
  const cells: string[] = [];
  for (const k of cellSet(d.cells)) {
    const [x, y] = k.split(",").map(Number);
    cells.push(key(2 * x, 2 * y), key(2 * x + 1, 2 * y), key(2 * x, 2 * y + 1), key(2 * x + 1, 2 * y + 1));
  }
  const halves = (e: Edge): Edge[] =>
    e.side === "n" ? [{ x: 2 * e.x, y: 2 * e.y, side: "n" }, { x: 2 * e.x + 1, y: 2 * e.y, side: "n" }] : [{ x: 2 * e.x, y: 2 * e.y, side: "w" }, { x: 2 * e.x, y: 2 * e.y + 1, side: "w" }];
  return {
    style: d.style,
    unit: 2,
    view: { x: 2 * d.view.x, y: 2 * d.view.y, w: 2 * d.view.w, h: 2 * d.view.h },
    cells: encodeCells(cells),
    tris: "",
    walls: d.walls.flatMap(halves),
    doors: d.doors.map((x) => ({ x: 2 * x.x, y: 2 * x.y, side: x.side, kind: x.kind, len: 2 })),
    labels: d.labels.map((l) => ({ x: 2 * l.x + 1, y: 2 * l.y + 1, n: l.n })),
    texts: d.texts.map((t) => ({ ...t, x: 2 * t.x, y: 2 * t.y })),
    stamps: [],
    paths: [],
    ground: [],
  };
}

export const key = (x: number, y: number) => `${x},${y}`;

const parsed = new Map<string, Set<string>>();

/** The painted cells as a set of "x,y" keys (cached per string; the string never changes in place). */
export function cellSet(cells: string): Set<string> {
  let set = parsed.get(cells);
  if (!set) {
    set = new Set(cells ? cells.split(" ") : []);
    parsed.set(cells, set);
    // A small cache: old strings only come back with undo.
    if (parsed.size > 64) parsed.delete(parsed.keys().next().value!);
  }
  return set;
}

/** Cells as a string, in reading order so equal sets give equal strings. */
export function encodeCells(set: Iterable<string>): string {
  const list = [...set].map((k) => k.split(",").map(Number) as [number, number]);
  list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return list.map(([x, y]) => key(x, y)).join(" ");
}

/** Bounds of the painted cells, in cells; null when there are none. */
export function cellBounds(set: Set<string>): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k of set) {
    const [x, y] = k.split(",").map(Number);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + 1);
    y1 = Math.max(y1, y + 1);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------------------------------------------------------------- walls

type Pt = [number, number];

/**
 * The outline of the floor: closed loops along every edge between floor and nothing, each going
 * round with the floor on its right (so outer walls run clockwise and the walls of holes
 * counter-clockwise, and a nonzero fill draws the floor with its holes).
 *
 * Every full cell adds its four sides and every half cell (`tris`) its three edges (the diagonal
 * one too), all clockwise; an edge that two floor pieces share appears both ways and cancels, so
 * what's left is the outline. Where two loops only touch at a point, the walk takes the sharpest
 * right turn, which keeps each room's loop its own.
 */
export function outlineLoops(set: Set<string>, tris: Map<string, Corner> = NO_TRIS): Pt[][] {
  const edges = new Set<string>();
  const add = (a: Pt, b: Pt) => {
    const back = `${b[0]},${b[1]}>${a[0]},${a[1]}`;
    if (edges.has(back)) edges.delete(back);
    else edges.add(`${a[0]},${a[1]}>${b[0]},${b[1]}`);
  };
  const polygon = (pts: Pt[]) => pts.forEach((p, i) => add(p, pts[(i + 1) % pts.length]));
  for (const k of set) {
    const [x, y] = k.split(",").map(Number);
    polygon([[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]);
  }
  for (const [k, corner] of tris) {
    if (set.has(k)) continue;
    const [x, y] = k.split(",").map(Number);
    polygon(triangle(x, y, corner));
  }

  // From each point, where the outline goes on.
  const out = new Map<string, Pt[]>();
  for (const e of edges) {
    const [a, b] = e.split(">");
    const list = out.get(a) ?? [];
    list.push(b.split(",").map(Number) as Pt);
    out.set(a, list);
  }

  const loops: Pt[][] = [];
  const take = (from: Pt, dir: Pt | null): Pt | undefined => {
    const k = key(from[0], from[1]);
    const list = out.get(k);
    if (!list?.length) return;
    let i = 0;
    if (list.length > 1 && dir) {
      // The sharpest right turn (clockwise on screen, y down): its signed angle is largest.
      const turn = (p: Pt) => {
        const ox = p[0] - from[0], oy = p[1] - from[1];
        return Math.atan2(dir[0] * oy - dir[1] * ox, dir[0] * ox + dir[1] * oy);
      };
      i = list.reduce((best, p, j) => (turn(p) > turn(list[best]) ? j : best), 0);
    }
    const [next] = list.splice(i, 1);
    if (!list.length) out.delete(k);
    return next;
  };
  while (out.size) {
    const startKey = out.keys().next().value!;
    const start = startKey.split(",").map(Number) as Pt;
    const loop: Pt[] = [start];
    let at = start, dir: Pt | null = null;
    for (;;) {
      const next = take(at, dir);
      if (!next) break;
      dir = [next[0] - at[0], next[1] - at[1]];
      if (next[0] === start[0] && next[1] === start[1]) break;
      loop.push(next);
      at = next;
    }
    // Only the corners: drop points where the line goes straight on.
    const corners = loop.filter((p, i) => {
      const a = loop[(i - 1 + loop.length) % loop.length], b = loop[(i + 1) % loop.length];
      return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
    });
    if (corners.length >= 3) loops.push(corners);
  }
  return loops;
}

// ---------------------------------------------------------------- half cells (diagonals)

/** A half cell: the floor half of a unit cut along a diagonal, named by the corner it holds. */
export type Corner = "nw" | "ne" | "se" | "sw";
const NO_TRIS = new Map<string, Corner>();

/** A half cell's corners, clockwise on screen (y down), so the floor is on the right of its edges. */
export function triangle(x: number, y: number, corner: Corner): Pt[] {
  switch (corner) {
    case "sw": return [[x, y], [x + 1, y + 1], [x, y + 1]];
    case "ne": return [[x, y], [x + 1, y], [x + 1, y + 1]];
    case "nw": return [[x, y], [x + 1, y], [x, y + 1]];
    case "se": return [[x + 1, y], [x + 1, y + 1], [x, y + 1]];
  }
}

const parsedTris = new Map<string, Map<string, Corner>>();

/** Half cells as "x,y" → corner (cached per string). */
export function triMap(tris: string): Map<string, Corner> {
  let map = parsedTris.get(tris);
  if (!map) {
    map = new Map();
    for (const t of tris ? tris.split(" ") : []) {
      const [x, y, c] = t.split(",");
      map.set(`${x},${y}`, c as Corner);
    }
    parsedTris.set(tris, map);
    if (parsedTris.size > 64) parsedTris.delete(parsedTris.keys().next().value!);
  }
  return map;
}

export function encodeTris(map: Map<string, Corner>): string {
  const list = [...map].map(([k, c]) => [...k.split(",").map(Number), c] as [number, number, Corner]);
  list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return list.map(([x, y, c]) => `${x},${y},${c}`).join(" ");
}

export const OPPOSITE: Record<Corner, Corner> = { nw: "se", ne: "sw", se: "nw", sw: "ne" };

/**
 * A painted cell (`s` units wide, at `at`) cut so only the half holding `corner` is floor: the
 * units it's made of, as full, half or empty. For a full cell (2×2 units), the units on the
 * diagonal become halves, the one at `corner` stays full and the one opposite goes.
 */
export function halfBlock(at: Pt, s: number, corner: Corner): { full: string[]; half: [string, Corner][]; empty: string[] } {
  const [x, y] = at;
  if (s === 1) return { full: [], half: [[key(x, y), corner]], empty: [] };
  const tl = key(x, y), tr = key(x + 1, y), bl = key(x, y + 1), br = key(x + 1, y + 1);
  switch (corner) {
    case "sw": return { full: [bl], half: [[tl, "sw"], [br, "sw"]], empty: [tr] };
    case "ne": return { full: [tr], half: [[tl, "ne"], [br, "ne"]], empty: [bl] };
    case "nw": return { full: [tl], half: [[tr, "nw"], [bl, "nw"]], empty: [br] };
    case "se": return { full: [br], half: [[tr, "se"], [bl, "se"]], empty: [tl] };
  }
}

/**
 * A cave's rough rock: every segment is cut into short pieces (at most `STEP` units) and each
 * point is nudged by a smooth function of its position (sums of sines), so the same spot always
 * moves the same way: the outline, interior walls and anything else that meets there stay joined.
 * Plain geometry, no filter, so it stays sharp and quick at any zoom.
 */
const STEP = 0.45;
const AMP = 0.13;
export function wobble([x, y]: Pt): Pt {
  const dx = Math.sin(x * 4.1 + y * 2.3) + 0.6 * Math.sin(x * 9.7 - y * 7.9 + 1.3);
  const dy = Math.sin(y * 4.7 - x * 1.9 + 2.1) + 0.6 * Math.sin(y * 8.9 + x * 6.3);
  return [Math.round((x + AMP * dx) * 1000) / 1000, Math.round((y + AMP * dy) * 1000) / 1000];
}
function roughLine(a: Pt, b: Pt): Pt[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP));
  return Array.from({ length: n }, (_, i) => wobble([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]));
}
export function roughLoops(loops: Pt[][]): Pt[][] {
  return loops.map((l) => l.flatMap((p, i) => roughLine(p, l[(i + 1) % l.length])));
}
/** Interior wall runs (`edgesPath`'s "M…L…" pairs), roughened the same way: open lines, ends included. */
export function roughRuns(d: string): string {
  let out = "";
  for (const run of d.match(/M[^M]+/g) ?? []) {
    const [a, b] = run.slice(1).split("L").map((p) => p.split(",").map(Number) as Pt);
    const pts = [...roughLine(a, b), wobble(b)];
    out += "M" + pts.map((p) => p.join(",")).join("L");
  }
  return out;
}

export const loopsPath = (loops: Pt[][]) => loops.map((l) => "M" + l.map((p) => p.join(",")).join("L") + "Z").join("");

// ---------------------------------------------------------------- doors and labels

/** An edge (or a door, `len` units long) as its two end points. */
export function doorEdge(d: Edge & { len?: number }): [Pt, Pt] {
  const len = d.len ?? 1;
  return d.side === "n" ? [[d.x, d.y], [d.x + len, d.y]] : [[d.x, d.y], [d.x, d.y + len]];
}

/** The unit edges a door (or an edge `len` long) covers. */
export function unitEdges(d: Edge & { len?: number }): Edge[] {
  return Array.from({ length: d.len ?? 1 }, (_, i) => (d.side === "n" ? { x: d.x + i, y: d.y, side: "n" } : { x: d.x, y: d.y + i, side: "w" }));
}

/** The two cells an edge lies between. */
export const doorCells = (d: Edge): [string, string] =>
  d.side === "n" ? [key(d.x, d.y - 1), key(d.x, d.y)] : [key(d.x - 1, d.y), key(d.x, d.y)];

/**
 * The edge nearest a point (units), on a grid of `step` units (2: full cells, 1: half), named by
 * its north or west form, `len` = `step` units long.
 */
export function nearestEdge(px: number, py: number, step = 1): Edge & { len: number } {
  const x = Math.floor(px / step), y = Math.floor(py / step);
  const fx = px / step - x, fy = py / step - y;
  const dist = { n: fy, s: 1 - fy, w: fx, e: 1 - fx };
  const side = (Object.keys(dist) as (keyof typeof dist)[]).reduce((a, b) => (dist[b] < dist[a] ? b : a));
  const at = (cx: number, cy: number, s: "n" | "w") => ({ x: cx * step, y: cy * step, side: s, len: step });
  if (side === "n") return at(x, y, "n");
  if (side === "s") return at(x, y + 1, "n");
  if (side === "w") return at(x, y, "w");
  return at(x + 1, y, "w");
}

export const sameEdge = (a: Edge, b: Edge) => a.x === b.x && a.y === b.y && a.side === b.side;
export const edgeKey = (e: Edge) => `${e.x},${e.y},${e.side}`;

/** The sides of a unit a half cell's floor runs along: the two next to its kept corner. */
const HALF_SIDES: Record<Corner, string> = { nw: "nw", ne: "ne", se: "se", sw: "sw" };

/** Whether a unit has floor along one side ("n", "e", "s" or "w"): a full unit all round, a half cell on the two sides at its kept corner. */
export function floorAlong(set: Set<string>, tris: Map<string, Corner>, cell: string, side: "n" | "e" | "s" | "w"): boolean {
  if (set.has(cell)) return true;
  const corner = tris.get(cell);
  return !!corner && HALF_SIDES[corner].includes(side);
}

/** Whether there's floor on each side of a unit edge: [before (above or left), after (below or right)]. */
export function floorBeside(e: Edge, set: Set<string>, tris: Map<string, Corner> = NO_TRIS): [boolean, boolean] {
  const [a, b] = doorCells(e);
  return e.side === "n" ? [floorAlong(set, tris, a, "s"), floorAlong(set, tris, b, "n")] : [floorAlong(set, tris, a, "e"), floorAlong(set, tris, b, "w")];
}

/** Doors whose edge still touches floor (painting and erasing can leave some stranded). */
export const liveDoors = (doors: Door[], set: Set<string>, tris: Map<string, Corner> = NO_TRIS) => doors.filter((d) => unitEdges(d).some((e) => floorBeside(e, set, tris).some(Boolean)));

/** Whether a door covers an edge. */
export const doorCovers = (d: Door, e: Edge) => unitEdges(d).some((u) => sameEdge(u, e));

/** Interior walls that still divide floor (floor on both sides). */
export const liveWalls = (walls: Edge[], set: Set<string>, tris: Map<string, Corner> = NO_TRIS) => walls.filter((w) => floorBeside(w, set, tris).every(Boolean));

/** The edges along a straight grid line from corner a to corner b (same row or same column). */
export function edgeRun(a: Pt, b: Pt): Edge[] {
  const out: Edge[] = [];
  if (a[1] === b[1]) for (let x = Math.min(a[0], b[0]); x < Math.max(a[0], b[0]); x++) out.push({ x, y: a[1], side: "n" });
  else if (a[0] === b[0]) for (let y = Math.min(a[1], b[1]); y < Math.max(a[1], b[1]); y++) out.push({ x: a[0], y, side: "w" });
  return out;
}

/** Walls as path data, edges along the same line merged into runs (so they join cleanly). */
export function edgesPath(edges: Edge[]): string {
  const rows = new Map<string, number[]>();
  for (const e of edges) {
    const k = e.side === "n" ? `h${e.y}` : `v${e.x}`;
    const list = rows.get(k) ?? [];
    list.push(e.side === "n" ? e.x : e.y);
    rows.set(k, list);
  }
  let d = "";
  for (const [k, list] of rows) {
    list.sort((a, b) => a - b);
    const line = Number(k.slice(1));
    for (let i = 0; i < list.length; ) {
      let j = i;
      while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
      d += k[0] === "h" ? `M${list[i]},${line}L${list[j] + 1},${line}` : `M${line},${list[i]}L${line},${list[j] + 1}`;
      i = j + 1;
    }
  }
  return d;
}

/** A text label's font size, in units. */
export const TEXT_SIZE = 1;

/** About the area a text label covers (cells): for the map's bounds and for clicking on it. */
export function textBox(t: MapText): Rect {
  const w = Math.max(1.2, t.text.length * TEXT_SIZE * 0.5);
  return { x: t.x - w / 2, y: t.y - TEXT_SIZE * 0.65, w, h: TEXT_SIZE * 1.3 };
}

/** The square a stamp covers (units). */
export const stampBox = (s: Stamp): Rect => ({ x: s.x - s.size / 2, y: s.y - s.size / 2, w: s.size, h: s.size });

/** The topmost stamp at a point (units), if any. */
export function stampAt(stamps: Stamp[], x: number, y: number): Stamp | undefined {
  for (let i = stamps.length - 1; i >= 0; i--) {
    const s = stamps[i];
    if (Math.abs(x - s.x) <= s.size / 2 && Math.abs(y - s.y) <= s.size / 2) return s;
  }
}

// ---------------------------------------------------------------- overlay paths

const round2 = (n: number) => Math.round(n * 100) / 100;
export const encodePath = (pts: Pt[]) => pts.map(([x, y]) => `${round2(x)} ${round2(y)}`).join(" ");

function parsePath(points: string): Pt[] {
  const n = points ? points.split(" ").map(Number) : [];
  const out: Pt[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
  return out;
}

const lines = new Map<string, Pt[]>();

/** The line a path draws: smoothed like a drawing's stroke, or straight segments when snapped. Cached. */
export function pathLine(p: MapPath): Pt[] {
  const key = `${p.snapped ? "s" : "f"}${p.px}|${p.points}`;
  let line = lines.get(key);
  if (!line) {
    const raw = parsePath(p.points);
    line = p.snapped ? raw : smoothPoints(raw.map(([x, y]) => [x, y, 0.5]), p.px, false).map(([x, y]): Pt => [x, y]);
    lines.set(key, line);
    if (lines.size > 200) lines.delete(lines.keys().next().value!);
  }
  return line;
}

export const linePath = (line: Pt[]) => (line.length ? "M" + line.map(([x, y]) => `${round2(x)},${round2(y)}`).join("L") : "");

export function pathBox(p: MapPath): Rect | null {
  const line = parsePath(p.points);
  if (!line.length) return null;
  const xs = line.map((q) => q[0]), ys = line.map((q) => q[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x: x - 0.5, y: y - 0.5, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 };
}

/** Whether a point is within `r` units of a path's line. */
export function nearPath(p: MapPath, x: number, y: number, r: number): boolean {
  const line = pathLine(p);
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1];
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
    if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= r) return true;
  }
  return false;
}

/** Points every `spacing` units along a line, with the direction there (degrees). */
function along(line: Pt[], spacing: number, start = spacing / 2): { x: number; y: number; angle: number }[] {
  const out: { x: number; y: number; angle: number }[] = [];
  let next = start, walked = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    const angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
    while (next <= walked + len) {
      const f = (next - walked) / len;
      out.push({ x: ax + (bx - ax) * f, y: ay + (by - ay) * f, angle });
      next += spacing;
    }
    walked += len;
  }
  return out;
}

/** Footprints along a line: left and right in turn, a step apart, pointing the way it goes. */
export function footprints(line: Pt[]): { x: number; y: number; angle: number }[] {
  return along(line, 0.78).map((s, i) => {
    const side = i % 2 ? 1 : -1, r = (s.angle * Math.PI) / 180;
    // Off the line to the left or right (perpendicular), and turned so the toes point ahead.
    return { x: s.x - Math.sin(r) * 0.17 * side, y: s.y + Math.cos(r) * 0.17 * side, angle: s.angle + 90 };
  });
}

/** Where an arrowhead goes: the line's end, pointing along its last stretch. */
export function arrowAt(line: Pt[]): { x: number; y: number; angle: number } | null {
  if (line.length < 2) return null;
  const end = line[line.length - 1];
  // Back along the line a little, so a wobble at the very end doesn't swing it.
  let i = line.length - 2;
  while (i > 0 && Math.hypot(end[0] - line[i][0], end[1] - line[i][1]) < 0.5) i--;
  const from = line[i];
  return { x: end[0], y: end[1], angle: (Math.atan2(end[1] - from[1], end[0] - from[0]) * 180) / Math.PI };
}

// ---------------------------------------------------------------- exterior

/** A string's hash, for steady per-stroke variation (wobbly edges, rock shapes). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

const outlines = new Map<string, string>();

/**
 * A terrain (or erase) stroke's area: a brush stroke outline whose width wobbles along it (a pen
 * outline with "pressure" from a smooth, per-stroke noise), so painted ground has natural edges.
 */
export function groundOutline(g: GroundStroke): string {
  const k = `${g.id}|${g.width}|${g.points}`;
  let d = outlines.get(k);
  if (d === undefined) {
    const phase = hash(g.id) * 100;
    const raw = parsePath(g.points).map(([x, y], i): [number, number, number] => [x, y, 0.8 + 0.2 * Math.sin(i * 0.45 + phase) * Math.cos(i * 0.17 + phase * 1.3)]);
    d = strokeOutline({ tool: "pen", size: g.width, pressure: true, px: g.px }, raw);
    outlines.set(k, d);
    if (outlines.size > 300) outlines.delete(outlines.keys().next().value!);
  }
  return d;
}

/** A road's center line (smoothed like a path), and its two edges `width` apart. */
export function roadLines(g: GroundStroke): { center: Pt[]; left: Pt[]; right: Pt[] } {
  const center = pathLine({ id: g.id, style: "dashed", color: "ink", points: g.points, px: g.px });
  const side = (sign: number) =>
    center.map((p, i): Pt => {
      const a = center[Math.max(0, i - 1)], b = center[Math.min(center.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      return [p[0] - (dy / len) * (g.width / 2) * sign, p[1] + (dx / len) * (g.width / 2) * sign];
    });
  return { center, left: side(1), right: side(-1) };
}

export function groundBox(g: GroundStroke): Rect | null {
  const box = pathBox({ id: g.id, style: "dashed", color: "ink", points: g.points, px: g.px });
  return box && { x: box.x - g.width / 2, y: box.y - g.width / 2, w: box.w + g.width, h: box.h + g.width };
}

/** Terrain marks, one path each (stroked), and the roads' dashed edges. */
export type GroundMarks = { dirt: string; grass: string; water: string; road: string; edges: string };

const KINDS = ["dirt", "grass", "water", "road"] as const;
type MarkKind = (typeof KINDS)[number];
/** Field resolution (units per sample), and how far in (units) each terrain's marks fade from its edge. */
const RES = 0.25;
const FADE: Record<MarkKind, number> = { dirt: 1.2, grass: 1.6, water: 0.9, road: 0.5 };
const MAX_FADE = Math.max(...Object.values(FADE));
/** Mark spacing per terrain (units, x and y of the jittered grid). */
const SPACING: Record<MarkKind, [number, number]> = { dirt: [0.3, 0.3], grass: [1.05, 0.95], water: [0.95, 0.55], road: [0.42, 0.42] };

const markCache = new Map<string, GroundMarks>();
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The exterior as marks, not fills: stipple for dirt, tufts for grass, waves for water, dots for
 * roads, each kind one path. The strokes are painted in order onto a field (which terrain is on
 * top at each point; erasing clears), then each kind's marks sit on a jittered grid where that
 * kind is on top, thinning and shrinking toward its edges (distance to anything else), so areas
 * fade out and neighbors blend instead of meeting at a hard line. Roads get dashed edges where
 * they're on top. Cached per set of strokes.
 */
export function groundMarks(ground: GroundStroke[]): GroundMarks | null {
  if (!ground.some((g) => g.kind !== "erase")) return null;
  const key = ground.map((g) => `${g.id}:${g.kind}:${g.width}:${g.points.length}`).join("|");
  const hit = markCache.get(key);
  if (hit) return hit;

  // The field's extent: the painted strokes' boxes.
  const boxes = ground.filter((g) => g.kind !== "erase").map(groundBox).filter((b): b is Rect => !!b);
  const x0 = Math.min(...boxes.map((b) => b.x)) - 1, y0 = Math.min(...boxes.map((b) => b.y)) - 1;
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)) + 1, y1 = Math.max(...boxes.map((b) => b.y + b.h)) + 1;
  const W = Math.ceil((x1 - x0) / RES), H = Math.ceil((y1 - y0) / RES);
  const field = new Uint8Array(W * H); // 0 nothing, 1 + index in KINDS

  // Paint each stroke: discs along its smoothed line, the radius wobbling a little along the way.
  for (const g of ground) {
    const code = g.kind === "erase" ? 0 : KINDS.indexOf(g.kind as MarkKind) + 1;
    const line = pathLine({ id: g.id, style: "dashed", color: "ink", points: g.points, px: g.px });
    const phase = hash(g.id) * 100;
    const stamp = (cx: number, cy: number, r: number) => {
      const gx0 = Math.max(0, Math.floor((cx - r - x0) / RES)), gx1 = Math.min(W - 1, Math.ceil((cx + r - x0) / RES));
      const gy0 = Math.max(0, Math.floor((cy - r - y0) / RES)), gy1 = Math.min(H - 1, Math.ceil((cy + r - y0) / RES));
      for (let gy = gy0; gy <= gy1; gy++) {
        const dy = y0 + gy * RES - cy;
        for (let gx = gx0; gx <= gx1; gx++) {
          const dx = x0 + gx * RES - cx;
          if (dx * dx + dy * dy <= r * r) field[gy * W + gx] = code;
        }
      }
    };
    let walked = 0;
    for (let i = 0; i < line.length; i++) {
      const [ax, ay] = line[i];
      const [bx, by] = line[Math.min(i + 1, line.length - 1)];
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(len / RES));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const wob = g.kind === "road" ? 1 : 0.86 + 0.14 * Math.sin((walked + len * t) * 0.9 + phase);
        stamp(ax + (bx - ax) * t, ay + (by - ay) * t, (g.width / 2) * wob);
      }
      walked += len;
      if (i + 1 >= line.length) break;
    }
  }

  // Distance (in samples) from each point to the nearest point of another kind, up to the fade.
  const maxD = Math.ceil(MAX_FADE / RES);
  const dist = new Uint8Array(W * H).fill(maxD);
  const queue: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (!field[i]) continue;
    const x = i % W, y = (i / W) | 0;
    const f = field[i];
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || field[i - 1] !== f || field[i + 1] !== f || field[i - W] !== f || field[i + W] !== f) {
      dist[i] = 1;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], d = dist[i] + 1;
    if (d >= maxD) continue;
    for (const j of [i - 1, i + 1, i - W, i + W]) {
      if (j < 0 || j >= W * H || field[j] !== field[i] || dist[j] <= d) continue;
      dist[j] = d;
      queue.push(j);
    }
  }
  const at = (x: number, y: number) => {
    const gx = Math.round((x - x0) / RES), gy = Math.round((y - y0) / RES);
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) return { kind: 0, edge: 0 };
    const i = gy * W + gx;
    const f = field[i];
    return { kind: f, edge: f ? Math.min(1, ((dist[i] - 0.5) * RES) / FADE[KINDS[f - 1]]) : 0 };
  };

  const out: GroundMarks = { dirt: "", grass: "", water: "", road: "", edges: "" };
  KINDS.forEach((kind, ki) => {
    const [sx, sy] = SPACING[kind];
    const parts: string[] = [];
    for (let row = Math.floor(y0 / sy); row * sy <= y1; row++) {
      // Rows offset by half a step, and every mark jittered, so nothing lines up.
      for (let col = Math.floor(x0 / sx) - 1; col * sx <= x1; col++) {
        const h1 = hash(`${kind}${col},${row}`), h2 = hash(`${row},${col}${kind}`);
        const x = (col + (row % 2) * 0.5 + (h1 - 0.5) * 0.6) * sx, y = (row + (h2 - 0.5) * 0.5) * sy;
        const here = at(x, y);
        if (here.kind !== ki + 1) continue;
        // Fewer and smaller toward the edge.
        if (h2 > here.edge * 1.15) continue;
        const k = 0.45 + 0.55 * here.edge;
        if (kind === "dirt" || kind === "road") parts.push(`M${r2(x)},${r2(y)}h0.01`);
        else if (kind === "grass") {
          const t = 0.38 * k, s = 0.11 * k;
          parts.push(`M${r2(x - s)},${r2(y)}l${r2(-s)},${r2(-t * 0.8)}M${r2(x)},${r2(y)}v${r2(-t)}M${r2(x + s)},${r2(y)}l${r2(s)},${r2(-t * 0.8)}`);
        } else {
          const w = 0.32 * k, a = 0.15 * k;
          parts.push(`M${r2(x - w)},${r2(y)}q${r2(w / 2)},${r2(-a)} ${r2(w)},0t${r2(w)},0`);
        }
      }
    }
    out[kind] = parts.join("");
  });

  // Road edges: dashed lines along each road where the road is still on top just inside them.
  const edgeParts: string[] = [];
  for (const g of ground) {
    if (g.kind !== "road") continue;
    const { left, right, center } = roadLines(g);
    for (const side of [left, right]) {
      let open = false;
      side.forEach(([x, y], i) => {
        // A little inside the edge, towards the center.
        const [cx, cy] = center[i];
        const ix = x + (cx - x) * 0.15, iy = y + (cy - y) * 0.15;
        const on = at(ix, iy).kind === KINDS.indexOf("road") + 1;
        if (on) edgeParts.push(`${open ? "L" : "M"}${r2(x)},${r2(y)}`);
        open = on;
      });
    }
  }
  out.edges = edgeParts.join("");

  markCache.set(key, out);
  if (markCache.size > 16) markCache.delete(markCache.keys().next().value!);
  return out;
}

/** Room numbers still on floor. */
export const liveLabels = (labels: RoomLabel[], set: Set<string>, tris: Map<string, Corner> = NO_TRIS) =>
  labels.filter((l) => {
    const k = key(Math.floor(l.x), Math.floor(l.y));
    return set.has(k) || tris.has(k);
  });

/**
 * Where a room number goes in the block of `s` units at `at`: the middle of a plain block, but
 * on floor when the block is cut (its middle sits on a diagonal wall): the middle of a full unit
 * in it, else the middle of a half cell's floor (a third of the way in from its corner).
 */
export function labelSpot(at: Pt, s: number, set: Set<string>, tris: Map<string, Corner>): Pt {
  const [x, y] = at;
  const units: Pt[] = s === 1 ? [[x, y]] : [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
  if (!units.some(([ux, uy]) => tris.has(key(ux, uy)))) return [x + s / 2, y + s / 2];
  const full = units.find(([ux, uy]) => set.has(key(ux, uy)));
  if (full) return [full[0] + 0.5, full[1] + 0.5];
  const [hx, hy] = units.find(([ux, uy]) => tris.has(key(ux, uy)))!;
  const c = tris.get(key(hx, hy))!;
  return [hx + (c.endsWith("w") ? 1 / 3 : 2 / 3), hy + (c.startsWith("n") ? 1 / 3 : 2 / 3)];
}

/** The smallest room number not in use. */
export function nextNumber(labels: RoomLabel[]): number {
  const used = new Set(labels.map((l) => l.n));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/** Cells on the line from a to b (Bresenham), for painting between pointer events. */
export function cellLine(a: Pt, b: Pt): Pt[] {
  const out: Pt[] = [];
  let [x, y] = a;
  const dx = Math.abs(b[0] - x), dy = -Math.abs(b[1] - y), sx = x < b[0] ? 1 : -1, sy = y < b[1] ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x, y]);
    if (x === b[0] && y === b[1]) break;
    const e2 = 2 * err;
    if (e2 >= dy) (err += dy), (x += sx);
    if (e2 <= dx) (err += dx), (y += sy);
  }
  return out;
}
