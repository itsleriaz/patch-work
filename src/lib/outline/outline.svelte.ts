import { SvelteSet } from "svelte/reactivity";
import { camera, doc } from "../app.svelte";
import { checklistData, isDone, progress } from "../checklist/model";
import { counterData } from "../counter/model";
import { aabb } from "../doc/geometry";
import type { CanvasNode, Rect } from "../doc/types";
import { frames, membersOf } from "../frame/frames.svelte";
import { frameData, isFrame } from "../frame/model";
import { parentOf, parents } from "../parent/parents.svelte";
import { drawingData } from "../drawing/model";
import { paletteData } from "../palette/model";
import { cellSet, mapData } from "../map/model";
import { pdfData } from "../pdf/model";
import { spriteData } from "../sprite/model";
import { formatTime, timerData } from "../timer/model";
import { pdfPages } from "../pdf/pdf.svelte";
import { pinData } from "../pin/model";
import { tableData } from "../table/model";
import { settings } from "../settings.svelte";
import { textData } from "../text/palette";

/**
 * The outliner's model: what each node is called, which rows show for a search and a filter,
 * and in what order. A frame's members are nested under it; everything else is top level.
 * Viewing, selecting and renaming only: rows can't be dragged (decided with the owner).
 */

export type OutlineSort = "stacking" | "newest" | "position" | "kind";
export type OutlineFilter = "all" | "images" | "sprites" | "videos" | "audio" | "pdfs" | "drawings" | "text" | "tasks" | "counters" | "tables" | "frames" | "pins";

export const SORTS: [OutlineSort, string][] = [
  ["stacking", "Stacking"],
  ["newest", "Newest"],
  ["position", "Position"],
  ["kind", "Kind"],
];

export const FILTERS: [OutlineFilter, string][] = [
  ["all", "Everything"],
  ["images", "Images"],
  ["sprites", "Sprites"],
  ["videos", "Videos"],
  ["audio", "Audio"],
  ["pdfs", "PDFs"],
  ["drawings", "Drawings"],
  ["text", "Text"],
  ["tasks", "Open tasks"],
  ["counters", "Counters"],
  ["tables", "Tables"],
  ["frames", "Frames"],
  ["pins", "Pins"],
];

class OutlineUi {
  query = $state("");
  filter = $state<OutlineFilter>("all");
  /** Frames folded in the list (not collapsed on the canvas). */
  folded = new SvelteSet<string>();
}
export const outlineUi = new OutlineUi();

/** First line of Markdown as plain text. */
function firstLine(md: string): string {
  const line = md.split("\n").find((l) => l.trim()) ?? "";
  return line
    .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+)/, "")
    .replace(/(\*\*|__|\*|_|`|~~)/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

/** What a node is called in the list, and a quiet detail shown after it. */
export function describe(n: CanvasNode): { name: string; detail: string } {
  switch (n.kind) {
    case "text":
      return { name: firstLine(textData(n.data).md) || "Text", detail: "" };
    case "checklist": {
      const d = checklistData(n.data);
      const p = progress(d.items);
      return { name: d.title.trim() || d.items[0]?.text.trim() || "Checklist", detail: `${p.done}/${p.total}` };
    }
    case "counter": {
      const d = counterData(n.data);
      return { name: d.label.trim() || "Counter", detail: d.goal ? `${d.value} / ${d.goal}` : String(d.value) };
    }
    case "frame": {
      const count = membersOf(n).length;
      return { name: frameData(n.data).title.trim() || "Frame", detail: String(count) };
    }
    case "table": {
      // Named by its first heading, if any; the detail is its size.
      const d = tableData(n.data);
      const name = (d.headerRow ? d.columns[0]?.name : "")?.trim() || (d.headerCol ? d.rows[0]?.name : "")?.trim() || "Table";
      return { name, detail: `${d.rows.length}×${d.columns.length}` };
    }
    case "pin": {
      const d = pinData(n.data);
      return { name: d.title.trim() || "Pin", detail: String(d.slot) };
    }
    case "map": {
      const d = mapData(n.data);
      const rooms = d.labels.length;
      return { name: "Map", detail: rooms ? (rooms === 1 ? "1 room" : `${rooms} rooms`) : `${cellSet(d.cells).size} cells` };
    }
    case "palette": {
      const d = paletteData(n.data);
      return { name: d.title.trim() || "Palette", detail: d.colors.length === 1 ? "1 color" : `${d.colors.length} colors` };
    }
    case "drawing": {
      const count = drawingData(n.data).strokes.length;
      return { name: "Drawing", detail: count === 1 ? "1 stroke" : `${count} strokes` };
    }
    case "timer": {
      const d = timerData(n.data);
      return { name: d.label.trim() || (d.mode === "stopwatch" ? "Stopwatch" : "Timer"), detail: d.mode === "countdown" ? formatTime(d.duration) : "" };
    }
    case "sprite": {
      const tag = spriteData(n.data).tag;
      return { name: doc.assetOf(n)?.name ?? "Sprite", detail: tag ?? "" };
    }
    case "pdf": {
      // The page it shows, once the document is open.
      const asset = doc.assetOf(n);
      const pages = asset && pdfPages.get(asset.hash);
      return { name: asset?.name ?? "PDF", detail: pages ? `${Math.min(pdfData(n.data).page, pages - 1) + 1}/${pages}` : "" };
    }
    default:
      return { name: doc.assetOf(n)?.name ?? n.kind, detail: "" };
  }
}

function matchesFilter(n: CanvasNode, filter: OutlineFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "images": return n.kind === "image" || n.kind === "gif";
    case "sprites": return n.kind === "sprite";
    case "videos": return n.kind === "video";
    case "audio": return n.kind === "audio";
    case "pdfs": return n.kind === "pdf";
    case "drawings": return n.kind === "drawing";
    case "text": return n.kind === "text";
    case "tasks": return n.kind === "checklist" && checklistData(n.data).items.some((t) => !isDone(t));
    case "counters": return n.kind === "counter";
    case "tables": return n.kind === "table";
    case "frames": return n.kind === "frame";
    case "pins": return n.kind === "pin";
  }
}

const KIND_ORDER = ["frame", "pin", "text", "checklist", "counter", "timer", "table", "map", "palette", "drawing", "image", "gif", "sprite", "pdf", "video", "audio"];

function comparer(sort: OutlineSort): (a: CanvasNode, b: CanvasNode) => number {
  switch (sort) {
    // Front first, like a layers list.
    case "stacking": return (a, b) => b.z - a.z;
    // The document keeps nodes in the order they were added (an undone delete comes back last).
    case "newest": {
      const order = new Map(doc.nodeList.map((n, i) => [n.id, i]));
      return (a, b) => order.get(b.id)! - order.get(a.id)!;
    }
    // Reading order: top to bottom, then left to right.
    case "position": return (a, b) => {
      const ra = aabb(a), rb = aabb(b);
      return ra.y - rb.y || ra.x - rb.x;
    };
    case "kind": return (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || describe(a).name.localeCompare(describe(b).name);
  }
}

export interface Row {
  node: CanvasNode;
  /** 0 for frames and loose nodes, one more inside a frame and under a parent. */
  depth: number;
  name: string;
  detail: string;
  /** Frames: whether its members are listed below it. */
  open?: boolean;
  /** Shown only as the frame or parent of matching nodes. */
  context?: boolean;
  /** Inside a collapsed frame (not on the canvas). */
  hidden?: boolean;
}

/**
 * `nodes` as trees: those whose parent isn't among them first, each followed by its children
 * (sorted, one level deeper), and theirs. `visit` returns false to leave a node out, unless
 * something under it is listed (then `visit` gets it again with `context`).
 */
function families<T>(nodes: CanvasNode[], depth: number, cmp: (a: CanvasNode, b: CanvasNode) => number, visit: (n: CanvasNode, depth: number, context: boolean) => T | null): T[] {
  const scope = new Set(nodes.map((n) => n.id));
  const walk = (list: CanvasNode[], d: number): T[] => {
    const out: T[] = [];
    for (const n of [...list].sort(cmp)) {
      // Deeper than any real chain: a cycle in a damaged file.
      const kids = d < depth + 32 ? (parents.children.get(n.id) ?? []).filter((id) => scope.has(id)).map((id) => doc.nodes[id]) : [];
      const below = walk(kids, d + 1);
      const self = visit(n, d, false) ?? (below.length ? visit(n, d, true) : null);
      if (self === null) continue;
      out.push(self, ...below);
    }
    return out;
  };
  return walk(nodes.filter((n) => !parentOf(n) || !scope.has(parentOf(n)!.id)), depth);
}

/** The rows to show, in order: frames with their (unfolded) members, then loose nodes; children under their parent. */
export function outlineRows(): Row[] {
  const query = outlineUi.query.trim().toLowerCase();
  const filtering = !!query || outlineUi.filter !== "all";
  const cmp = comparer(settings.outlineSort);
  const matches = (n: CanvasNode) => {
    if (!matchesFilter(n, outlineUi.filter)) return false;
    if (!query) return true;
    const { name, detail } = describe(n);
    return `${name} ${detail}`.toLowerCase().includes(query);
  };
  const row = (node: CanvasNode, depth: number, extra: Partial<Row> = {}): Row => ({ node, depth, ...describe(node), ...extra });
  const tree = (nodes: CanvasNode[], depth: number, hidden?: boolean) =>
    families(nodes, depth, cmp, (n, d, context) => (context || matches(n) ? row(n, d, { context, hidden }) : null));

  const out: Row[] = [];
  for (const f of [...frames.list].sort(cmp)) {
    const shown = tree(membersOf(f), 1, frameData(f.data).collapsed);
    const self = matches(f);
    if (!self && !shown.length) continue;
    // Searching shows matching members whatever the folding.
    const open = filtering ? shown.length > 0 : !outlineUi.folded.has(f.id);
    out.push(row(f, 0, { open, context: !self }));
    if (open) out.push(...shown);
  }
  out.push(...tree(doc.nodeList.filter((n) => !isFrame(n) && !frames.owner.has(n.id)), 0));
  return out;
}

/**
 * Every node in the outliner's order (its sort; frames followed by their members, then loose
 * nodes), ignoring its search and filter. Find on the board can step through matches this way.
 */
export function outlineOrder(): string[] {
  const cmp = comparer(settings.outlineSort);
  const out: string[] = [];
  const ids = (nodes: CanvasNode[]) => families(nodes, 0, cmp, (n) => n.id);
  for (const f of [...frames.list].sort(cmp)) out.push(f.id, ...ids(membersOf(f)));
  out.push(...ids(doc.nodeList.filter((n) => !isFrame(n) && !frames.owner.has(n.id))));
  return out;
}

/** The part of the view the side panel leaves uncovered, in world units. */
export function visibleWorld(): Rect {
  const v = camera.viewRect;
  return { x: v.x, y: v.y, w: (camera.width - camera.insetRight) / camera.zoom, h: v.h };
}

/** Whether any part of a node is in view (outside the side panel). */
export function inView(n: CanvasNode): boolean {
  const r = aabb(n), v = visibleWorld();
  return r.x + r.w >= v.x && r.x <= v.x + v.w && r.y + r.h >= v.y && r.y <= v.y + v.h;
}

/**
 * Flies the camera to a node (or the collapsed frame hiding it), framing it without zooming in
 * past the current zoom or 100%, whichever is more.
 */
export function flyToNode(id: string) {
  const owner = frames.hidden.has(id) ? frames.owner.get(id) : undefined;
  const n = doc.nodes[owner ?? id];
  if (!n) return;
  const r = aabb(n);
  // A pin is a point: give it some room.
  const rect = r.w || r.h ? r : { x: r.x - 100, y: r.y - 100, w: 200, h: 200 };
  const pad = 64;
  const fit = Math.min((camera.width - camera.insetRight - pad * 2) / rect.w, (camera.height - pad * 2) / rect.h);
  const zoom = Math.min(fit, Math.max(camera.zoom, 1));
  const target = { zoom, x: camera.centerX - (rect.x + rect.w / 2) * zoom, y: camera.height / 2 - (rect.y + rect.h / 2) * zoom };
  if (settings.calm) camera.animateTo(target, 280);
  else camera.flyTo(target);
}
