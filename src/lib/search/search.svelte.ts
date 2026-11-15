import { camera, doc, selectLinks, selectOnly, ui } from "../app.svelte";
import { paletteData } from "../palette/model";
import { checklistData, flatten } from "../checklist/model";
import { checklistUi } from "../checklist/state.svelte";
import { counterData } from "../counter/model";
import { timerData } from "../timer/model";
import { aabb, union, type Point } from "../doc/geometry";
import type { CanvasLink, CanvasNode, Rect } from "../doc/types";
import { frames } from "../frame/frames.svelte";
import { frameData } from "../frame/model";
import { play } from "../juice/sound";
import { linkData } from "../links/palette";
import { flyToNode, inView, outlineOrder, visibleWorld } from "../outline/outline.svelte";
import { pinData } from "../pin/model";
import { settings } from "../settings.svelte";
import { cellText, tableData } from "../table/model";
import { HEAD, tableUi } from "../table/table.svelte";
import { textData } from "../text/palette";

/**
 * Find on the board (Ctrl/⌘+F): every place whose text contains the query. A place is a text
 * card, a checklist's title or one of its tasks, a table's heading or cell, a counter's label, a
 * frame's or pin's title, a file's name, or a link's label. Matches are ordered by
 * `settings.findOrder`; within a node, its places keep their own order.
 */

export type Spot = { kind: "task"; itemId: string } | { kind: "cell"; rowId: string; colId: string };

export interface Match {
  /** The node it's in, or the link whose label it is. */
  node?: CanvasNode;
  link?: CanvasLink;
  /** Where inside the node, when it's a part of it. */
  spot?: Spot;
  /** The text around the match, and where the match is in it. */
  before: string;
  hit: string;
  after: string;
  /** Where it is, e.g. "Checklist › Shoot". */
  where: string;
  /** The node's kind, or "link", for the list's icons. */
  kind: string;
}

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

class SearchUi {
  open = $state(false);
  query = $state("");
  /** The current match. */
  index = $state(0);
  /** Enter has been pressed for this query: the next Enter moves on instead of going to the first. */
  visited = $state(false);
  /** Nodes with matches, for a faint ring on the board. */
  hits = $state.raw<Set<string>>(new Set());
  /** Bumped to put the cursor back in the search field. */
  focusKey = $state(0);
  /**
   * Where "nearest" is measured from: the middle of the uncovered view when the query (or an
   * option) last changed. Fixed while stepping, so flying to a match doesn't reshuffle the list.
   */
  origin = $state.raw<Point>({ x: 0, y: 0 });
}
export const searchUi = new SearchUi();

export const findOptions = (): FindOptions => ({ matchCase: settings.findCase, wholeWord: settings.findWord });

const CONTEXT = 28;
const WORD = /[\p{L}\p{N}_]/u;

/** Where `q` starts in `text`, every time, honoring the case and whole-word options. */
export function occurrences(text: string, q: string, o: FindOptions): number[] {
  if (!q) return [];
  const hay = o.matchCase ? text : text.toLowerCase();
  const needle = o.matchCase ? q : q.toLowerCase();
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
    if (!o.wholeWord || (!WORD.test(text[i - 1] ?? "") && !WORD.test(text[i + needle.length] ?? ""))) out.push(i);
  }
  return out;
}

/** The first match in `text`, cut down to the words around it; null when there's none. */
function cut(text: string, q: string, o: FindOptions): Pick<Match, "before" | "hit" | "after"> | null {
  const flat = text.replace(/\s+/g, " ");
  const i = occurrences(flat, q, o)[0];
  if (i === undefined) return null;
  const start = Math.max(0, i - CONTEXT), end = Math.min(flat.length, i + q.length + CONTEXT);
  return {
    before: (start > 0 ? "…" : "") + flat.slice(start, i),
    hit: flat.slice(i, i + q.length),
    after: flat.slice(i + q.length, end) + (end < flat.length ? "…" : ""),
  };
}

/** Markdown with its formatting marks taken out, so "**bold**" matches "bold". */
const plain = (md: string) => md.replace(/[*_`~#>]+/g, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");

/** Where a node is on the board: its bounds, or its collapsed frame's when it's hidden in one. */
const placeOf = (n: CanvasNode): Rect => aabb(frames.hidden.has(n.id) ? (doc.nodes[frames.owner.get(n.id) ?? ""] ?? n) : n);

/** The node drawn for `id`: itself, or the collapsed frame hiding it. */
const shownId = (id: string) => (frames.hidden.has(id) ? (frames.owner.get(id) ?? id) : id);

/** Between a link's two ends (as drawn). */
function linkRect(l: CanvasLink): Rect | null {
  const a = doc.nodes[shownId(l.from)], b = doc.nodes[shownId(l.to)];
  return a && b ? union([aabb(a), aabb(b)]) : null;
}

/** How far a point is from a rectangle (0 inside it). */
const distance = (p: Point, r: Rect) => Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.w), Math.max(r.y - p.y, 0, p.y - r.y - r.h));

/** Every match of `query`, in the order of `settings.findOrder`. */
export function findMatches(query: string, o: FindOptions = findOptions(), origin: Point = searchUi.origin): Match[] {
  const q = query.trim();
  if (!q) return [];
  /** Matches grouped by node (or link), each group with where it is on the board. */
  const groups: { id: string; rect: Rect; matches: Match[] }[] = [];
  let group: Match[] = [];
  const add = (target: { node?: CanvasNode; link?: CanvasLink }, text: string, where: string, spot?: Spot) => {
    const m = cut(text, q, o);
    if (m) group.push({ ...target, spot, where, kind: target.node?.kind ?? "link", ...m });
  };

  for (const n of doc.nodeList) {
    group = [];
    const at = { node: n };
    switch (n.kind) {
      case "text":
        add(at, plain(textData(n.data).md), "Text");
        break;
      case "checklist": {
        const d = checklistData(n.data);
        const list = d.title.trim() || "Checklist";
        add(at, d.title, "Checklist");
        for (const { item } of flatten(d.items)) add(at, item.text, `Checklist › ${list}`, { kind: "task", itemId: item.id });
        break;
      }
      case "table": {
        const d = tableData(n.data);
        const name = (d.headerRow ? d.columns[0]?.name : "")?.trim() || "Table";
        if (d.headerRow) for (const c of d.columns) add(at, c.name, `Table › ${name}`, { kind: "cell", rowId: HEAD, colId: c.id });
        for (const r of d.rows) {
          if (d.headerCol) add(at, r.name, `Table › ${name}`, { kind: "cell", rowId: r.id, colId: HEAD });
          for (const c of d.columns) add(at, cellText(d, r, c), `Table › ${name}`, { kind: "cell", rowId: r.id, colId: c.id });
        }
        break;
      }
      case "counter":
        add(at, counterData(n.data).label, "Counter");
        break;
      case "timer":
        add(at, timerData(n.data).label, "Timer");
        break;
      case "frame":
        add(at, frameData(n.data).title, "Frame");
        break;
      case "pin":
        add(at, pinData(n.data).title, `Pin ${pinData(n.data).slot}`);
        break;
      case "palette": {
        // Its title and each color's hex code.
        const d = paletteData(n.data);
        add(at, d.title, "Palette");
        for (const c of d.colors) add(at, c.hex, "Color");
        break;
      }
      default: {
        const asset = doc.assetOf(n);
        if (asset) add(at, asset.name, n.kind === "gif" ? "Image" : n.kind === "pdf" ? "PDF" : n.kind === "sprite" ? "Sprite" : n.kind[0].toUpperCase() + n.kind.slice(1));
      }
    }
    if (group.length) groups.push({ id: n.id, rect: placeOf(n), matches: group });
  }
  for (const l of doc.linkList) {
    group = [];
    add({ link: l }, linkData(l.data).label, "Link");
    // Where its label is: halfway between its ends.
    const r = group.length && linkRect(l);
    if (r) groups.push({ id: l.id, rect: { x: r.x + r.w / 2, y: r.y + r.h / 2, w: 0, h: 0 }, matches: group });
  }

  const reading = (a: { rect: Rect }, b: { rect: Rect }) => a.rect.y - b.rect.y || a.rect.x - b.rect.x;
  if (settings.findOrder === "nearest") {
    groups.sort((a, b) => distance(origin, a.rect) - distance(origin, b.rect) || reading(a, b));
  } else if (settings.findOrder === "outline") {
    // Links aren't in the outliner: they come last, in reading order.
    const order = new Map(outlineOrder().map((id, i) => [id, i]));
    const rank = (g: { id: string }) => order.get(g.id) ?? Infinity;
    groups.sort((a, b) => rank(a) - rank(b) || reading(a, b));
  } else {
    groups.sort(reading);
  }
  return groups.flatMap((g) => g.matches);
}

/** The middle of the part of the view the side panel leaves uncovered, in world units. */
export function viewMiddle(): Point {
  const v = visibleWorld();
  return { x: v.x + v.w / 2, y: v.y + v.h / 2 };
}

/**
 * Points a match out: its node gets the ring (an edge arrow when off-screen), a task or cell in
 * it glows; a link's two ends get the ring. With `go`, it also selects the node (or link) and
 * flies there when it's out of view. `glow: false` points out without the glow (hovering a row).
 */
export function showMatch(m: Match | undefined, go: boolean, glow = true) {
  if (!m) {
    ui.highlight = new Set();
    return;
  }
  if (m.link) {
    const l = m.link;
    ui.highlight = new Set([shownId(l.from), shownId(l.to)]);
    if (!go) return;
    selectLinks([l.id]);
    const r = linkRect(l), v = visibleWorld();
    const seen = r && r.x >= v.x && r.y >= v.y && r.x + r.w <= v.x + v.w && r.y + r.h <= v.y + v.h;
    if (r && !seen) camera.frame(r, { maxZoom: Math.max(camera.zoom, 1) });
    play("tap", { volume: 0.4, pitch: 1.1 });
    return;
  }
  const id = m.node!.id;
  // A member of a collapsed frame is shown by the frame.
  const shown = shownId(id);
  ui.highlight = new Set([shown]);
  if (glow && m.spot?.kind === "task") checklistUi.flash = { nodeId: id, itemId: m.spot.itemId, key: (checklistUi.flash?.key ?? 0) + 1 };
  if (glow && m.spot?.kind === "cell") tableUi.flash = { nodeId: id, rowId: m.spot.rowId, colId: m.spot.colId, key: (tableUi.flash?.key ?? 0) + 1 };
  if (!go) return;
  selectOnly([shown]);
  const node = doc.nodes[shown];
  if (node && !inView(node)) flyToNode(shown);
  play("tap", { volume: 0.4, pitch: 1.1 });
}

// ---------------------------------------------------------------- highlighting the words

/**
 * Marks every occurrence in the matching nodes' rendered text with the CSS Custom Highlight API
 * (`::highlight(pw-find)` in app.css), the current match's more strongly. No elements are added
 * or changed, so it works the same in text cards, tasks, cells and titles. Only mounted nodes are
 * marked, so call it again after the camera moves. Engines without the API get no marks.
 */
const registry = typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : null;

export function markWords(matches: Match[], current: Match | undefined, query: string, o: FindOptions) {
  if (!registry) return;
  const q = query.trim();
  const all: Range[] = [], strong: Range[] = [];
  const ids = new Set(matches.flatMap((m) => (m.node ? [m.node.id] : [])));
  for (const id of ids) {
    const content = document.querySelector(`[data-node-id="${CSS.escape(id)}"] .content`);
    if (!content) continue;
    // The current match's own place: its task row or cell, else the whole node.
    let place: Element | null = null;
    if (current?.node?.id === id) {
      const s = current.spot;
      place = s?.kind === "task" ? content.querySelector(`[data-item-id="${CSS.escape(s.itemId)}"]`)
        : s?.kind === "cell" ? content.querySelector(`[data-cell="${CSS.escape(`${s.rowId}:${s.colId}`)}"]`)
        : content;
    }
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
      for (const i of occurrences(t.data, q, o)) {
        const r = new Range();
        r.setStart(t, i);
        r.setEnd(t, i + q.length);
        (place?.contains(t) ? strong : all).push(r);
      }
    }
  }
  registry.set("pw-find", new Highlight(...all));
  const current_ = new Highlight(...strong);
  current_.priority = 1;
  registry.set("pw-find-current", current_);
}

export function clearWords() {
  registry?.delete("pw-find");
  registry?.delete("pw-find-current");
}

// ---------------------------------------------------------------- opening and closing

/** Opens the find bar, or puts the cursor back in it. */
export function openSearch() {
  searchUi.open = true;
  searchUi.focusKey++;
}

/** Closes the search and lets go of what it pointed out. */
export function closeSearch() {
  searchUi.open = false;
  searchUi.hits = new Set();
  ui.highlight = new Set();
  clearWords();
}
