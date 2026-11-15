import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { camera, doc, history, markFresh, selectedNodes, selectOnly, selection, ui } from "../app.svelte";
import { isPin, pinBox } from "../pin/model";
import { snap } from "../canvas/layout";
import type { NodeChange, Op } from "../doc/ops.svelte";
import type { Point } from "../doc/geometry";
import type { CanvasNode, Rect } from "../doc/types";
import { play } from "../juice/sound";
import { playing } from "../media/playback.svelte";
import { familiesOf, familyMembers, familyTargets } from "../parent/parents.svelte";
import { aabb, union } from "../doc/geometry";
import { settings } from "../settings.svelte";
import {
  centerOf,
  collapsedSize,
  contains,
  DEFAULT_FRAME,
  fitRect,
  FRAME_TITLE,
  frameData,
  isFrame,
  isManual,
  NEW_FRAME_H,
  NEW_FRAME_W,
  type FrameColor,
  type FrameData,
} from "./model";

class FrameUi {
  /** A frame whose title is being edited inline. */
  editing = $state<string | null>(null);
  /** Frames left as they are during a drag of their members (so a member can be dragged out). */
  frozen = new SvelteSet<string>();
  /** The frame a dragged node would join if dropped now. */
  dropTarget = $state<string | null>(null);
  /** The frame a dragged member would leave if dropped now (its center is outside it). */
  leaving = $state<string | null>(null);
  /**
   * Nodes just dropped into a collapsed frame, shrinking into its card: still drawn for a moment,
   * moved by this offset (in the node's own frame) toward the card's middle.
   */
  tucking = new SvelteMap<string, { dx: number; dy: number }>();
  /** A collapsed frame that just took nodes in: its card bounces. */
  gulp = $state<string | null>(null);
}
export const frameUi = new FrameUi();

class Frames {
  list = $derived(doc.nodeList.filter(isFrame));
  /** Member id → its frame's id (existing members only). */
  owner = $derived.by(() => {
    const m = new Map<string, string>();
    for (const f of this.list) for (const id of frameData(f.data).members) if (doc.nodes[id]) m.set(id, f.id);
    return m;
  });
  /** Members of collapsed frames: not drawn, not hittable. */
  hidden = $derived.by(() => {
    const s = new Set<string>();
    for (const f of this.list) {
      const d = frameData(f.data);
      if (d.collapsed) for (const id of d.members) if (doc.nodes[id]) s.add(id);
    }
    return s;
  });
}
export const frames = new Frames();

/** A frame's existing members. */
export function membersOf(frame: CanvasNode): CanvasNode[] {
  return frameData(frame.data).members.map((id) => doc.nodes[id]).filter((n): n is CanvasNode => !!n && !isFrame(n));
}

/** These ids plus the members of any frames among them (what moves, deletes or copies with a frame). */
export function withMembers(ids: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    out.add(id);
    const n = doc.nodes[id];
    if (isFrame(n)) for (const m of membersOf(n)) out.add(m.id);
  }
  return [...out];
}

/** What deleting these nodes removes: frames' members with them, and auto-fit frames left with none. */
export function deletionSet(ids: Iterable<string>): string[] {
  const out = new Set(withMembers(ids));
  for (const f of frames.list) {
    if (out.has(f.id) || isManual(f)) continue;
    const members = membersOf(f);
    if (members.length && members.every((m) => out.has(m.id))) out.add(f.id);
  }
  return [...out];
}

/**
 * The node to draw in place of `id` (for links): itself, or the collapsed frame hiding it. A pin
 * gives its marker's head (`shown`).
 */
export function shownNode(id: string): CanvasNode | undefined {
  const owner = frames.hidden.has(id) ? frames.owner.get(id) : undefined;
  const n = doc.nodes[owner ?? id];
  return n && shown(n);
}

/** A node as links, link handles and hovering see it: a pin as its marker's head at this zoom. */
export const shown = (n: CanvasNode): CanvasNode => (isPin(n) ? pinBox(n, camera.zoom) : n);

/**
 * Keeps every frame's box right: auto-fit frames fit their members, manual ones have their size,
 * collapsed ones are a compact card at their top-left. Derived geometry, written directly (outside
 * history) like a text card's height. Frozen frames are skipped during a drag. Called from an
 * effect in Canvas.
 */
export function syncFrames() {
  for (const f of frames.list) {
    if (frameUi.frozen.has(f.id)) continue;
    const d = frameData(f.data);
    const r = d.collapsed
      ? { x: f.x, y: f.y, ...collapsedSize(union(membersOf(f).map(aabb)), settings.framePreviews) }
      : d.size
        ? { x: f.x, y: f.y, ...d.size }
        : fitRect(membersOf(f));
    if (!r) continue;
    if (Math.abs(r.x - f.x) > 0.5 || Math.abs(r.y - f.y) > 0.5 || Math.abs(r.w - f.w) > 0.5 || Math.abs(r.h - f.h) > 0.5) {
      Object.assign(f, r);
    }
  }
}

/**
 * The frame (not among `exclude`) whose box contains a point: where a dropped node would join.
 * `expandedOnly` skips collapsed frames (new nodes never disappear into one).
 */
export function frameAt(p: Point, exclude: Set<string> = new Set(), expandedOnly = false): string | null {
  for (const f of frames.list) {
    if (exclude.has(f.id) || (expandedOnly && frameData(f.data).collapsed)) continue;
    if (contains(f, p)) return f.id;
  }
  return null;
}

/**
 * Where a frame can be hovered or linked to: its title bar (all of a collapsed one) or a band
 * `band` world units either side of its border. Its empty inside counts as canvas.
 */
export function frameEdgeHit(f: CanvasNode, p: Point, band: number): boolean {
  const outer = { x: f.x - band, y: f.y - band, w: f.w + band * 2, h: f.h + band * 2 };
  if (!contains(outer, p)) return false;
  const title = frameData(f.data).collapsed ? f.h : FRAME_TITLE;
  const inner = { x: f.x + band, y: f.y + title, w: f.w - band * 2, h: f.h - title - band };
  return inner.w <= 0 || inner.h <= 0 || !contains(inner, p);
}

/**
 * The members a frame gets from a box: nodes whose center is inside it that are free or already
 * its own (nodes in other frames stay there). Members that no longer exist are kept, so undoing
 * their deletion brings them back into it.
 */
export function membersIn(box: Rect, frameId: string | null): string[] {
  const own = frameId ? frameData(doc.nodes[frameId]?.data).members : [];
  const kept = own.filter((id) => !doc.nodes[id] || contains(box, centerOf(doc.nodes[id])));
  const joining = doc.nodeList.filter(
    (n) => !isFrame(n) && !frames.hidden.has(n.id) && !frames.owner.has(n.id) && !kept.includes(n.id) && contains(box, centerOf(n)),
  );
  return familyMembers([...kept, ...joining.map((n) => n.id)]);
}

const update = (f: CanvasNode, d: FrameData): Op => ({ type: "updateNodes", changes: [{ id: f.id, props: { data: d } }] });

/**
 * Ops that move nodes between frames: each id to its target frame (null: out of any frame).
 * An auto-fit frame left with no members is removed (it has no size without them).
 */
export function reassign(targets: Map<string, string | null>): Op[] {
  const lists = new Map(frames.list.map((f) => [f.id, [...frameData(f.data).members]]));
  for (const [id, target] of targets) {
    for (const [fid, list] of lists) {
      const i = list.indexOf(id);
      if (i >= 0 && fid !== target) list.splice(i, 1);
    }
    const into = target ? lists.get(target) : undefined;
    if (into && !into.includes(id)) into.push(id);
  }
  const ops: Op[] = [];
  for (const f of frames.list) {
    const before = frameData(f.data).members, after = lists.get(f.id)!;
    if (before.length === after.length && before.every((id, i) => id === after[i])) continue;
    if (!isManual(f) && !after.some((id) => doc.nodes[id])) ops.push({ type: "removeNodes", ids: [f.id] });
    else ops.push(update(f, { ...frameData(f.data), members: after }));
  }
  return ops;
}

/**
 * Ops putting new nodes into an expanded frame: the one under `at` (where they were created,
 * dropped or pasted) for all of them, or else the one each node's center lands in. Frames among
 * them, and nodes already in one of the new frames (a pasted frame's contents), stay as they are.
 * Run them right after the `addNodes` op.
 */
export function joinOps(nodes: CanvasNode[], at?: Point): Op[] {
  const inNew = new Set(nodes.filter(isFrame).flatMap((f) => frameData(f.data).members));
  const targets = new Map<string, string | null>();
  for (const n of nodes) {
    if (isFrame(n) || inNew.has(n.id)) continue;
    const into = frameAt(at ?? centerOf(n), new Set(), true);
    if (into) targets.set(n.id, into);
  }
  return targets.size ? reassign(familyTargets(targets)) : [];
}

/**
 * Node changes plus the same moves for the members of any frames among them, so arranging a
 * frame (align, tidy) takes its contents along. Members with changes of their own keep those.
 */
export function carryMembers(changes: NodeChange[]): NodeChange[] {
  const changed = new Set(changes.map((c) => c.id));
  const out = [...changes];
  for (const c of changes) {
    const f = doc.nodes[c.id];
    if (!isFrame(f)) continue;
    const dx = typeof c.props.x === "number" ? c.props.x - f.x : 0;
    const dy = typeof c.props.y === "number" ? c.props.y - f.y : 0;
    if (!dx && !dy) continue;
    for (const m of membersOf(f)) if (!changed.has(m.id) && !m.locked) out.push({ id: m.id, props: { x: m.x + dx, y: m.y + dy } });
  }
  return out;
}

// ---------------------------------------------------------------- commands

/** A new manual frame centered on `at`, taking in the free nodes inside it; its title editor opens. */
export function createFrame(at: Point) {
  const box = { x: snap(at.x - NEW_FRAME_W / 2), y: snap(at.y - NEW_FRAME_H / 2), w: NEW_FRAME_W, h: NEW_FRAME_H };
  const frame: CanvasNode = {
    id: crypto.randomUUID(),
    kind: "frame",
    assetId: null,
    ...box,
    rotation: 0,
    z: 0,
    data: { ...DEFAULT_FRAME, members: membersIn(box, null), size: { w: box.w, h: box.h } },
  };
  history.run("Add frame", [{ type: "addNodes", nodes: [frame] }]);
  selectOnly([frame.id]);
  markFresh([frame.id]);
  frameUi.editing = frame.id;
}

/**
 * Wraps the selected nodes in a new frame (taking them out of any frame they were in), with their
 * whole families: a family shares one frame.
 */
export function frameSelection() {
  const selected = selectedNodes().filter((n) => !isFrame(n) && !frames.hidden.has(n.id));
  const nodes = familiesOf(selected).map((id) => doc.nodes[id]);
  const box = fitRect(nodes);
  if (!nodes.length || !box) return;
  const ids = nodes.map((n) => n.id);
  const frame: CanvasNode = {
    id: crypto.randomUUID(),
    kind: "frame",
    assetId: null,
    ...box,
    rotation: 0,
    z: 0,
    data: { ...DEFAULT_FRAME, members: ids },
  };
  history.run(`Frame ${ids.length} node${ids.length > 1 ? "s" : ""}`, [
    ...reassign(new Map(ids.map((id) => [id, null]))),
    { type: "addNodes", nodes: [frame] },
  ]);
  selectOnly([frame.id]);
  markFresh([frame.id]);
  frameUi.editing = frame.id;
}

const selectedFrames = () => selectedNodes().filter(isFrame);

/** Removes the selected frames, keeping their contents (selected afterwards). */
export function ungroup() {
  const fs = selectedFrames();
  if (!fs.length) return;
  const members = fs.flatMap((f) => membersOf(f).map((m) => m.id));
  history.run(fs.length > 1 ? "Ungroup frames" : "Ungroup", [{ type: "removeNodes", ids: fs.map((f) => f.id) }]);
  selectOnly(members);
}

/** Takes the selected nodes out of their frames. */
export function removeFromFrame() {
  // With their families: a child leaves with its root.
  const ids = familiesOf(selectedNodes().filter((n) => frames.owner.has(n.id)));
  if (ids.length) history.run("Remove from frame", reassign(new Map(ids.map((id) => [id, null]))));
}

export function toggleCollapse() {
  const fs = selectedFrames();
  if (!fs.length) return;
  const collapse = !fs.every((f) => frameData(f.data).collapsed);
  history.run(collapse ? "Collapse frame" : "Expand frame", fs.map((f) => update(f, { ...frameData(f.data), collapsed: collapse })));
  // Members that just disappeared can't stay selected, or keep playing.
  if (collapse) {
    for (const id of selection.values()) if (frames.hidden.has(id)) selection.delete(id);
    for (const id of frames.hidden) playing.delete(id);
  }
  play(collapse ? "toggleOff" : "toggleOn", { volume: 0.6 });
}

/**
 * Turns auto-fit on for the selected frames, or off when all of them fit already (they keep their
 * current box). An empty frame can't fit anything, so it stays manual. Positions are recorded
 * too: a manual frame's are real state, an auto-fit one's derived.
 */
export function toggleFit() {
  const fs = selectedFrames();
  if (!fs.length) return;
  const changes: NodeChange[] = [];
  if (fs.every((f) => !isManual(f))) {
    for (const f of fs) {
      const d = frameData(f.data);
      const fit = fitRect(membersOf(f));
      const size = d.collapsed && fit ? { w: fit.w, h: fit.h } : { w: f.w, h: f.h };
      changes.push({ id: f.id, props: { data: { ...d, size } } });
    }
  } else {
    let empty = 0;
    for (const f of fs) {
      const d = frameData(f.data);
      if (!d.size) continue;
      const fit = fitRect(membersOf(f));
      if (!fit) {
        empty++;
        continue;
      }
      changes.push({ id: f.id, props: { data: { ...d, size: null }, ...(d.collapsed ? {} : fit) } });
    }
    if (empty) ui.notify(empty > 1 ? "Empty frames have nothing to fit" : "An empty frame has nothing to fit");
  }
  if (!changes.length) return;
  const on = changes.some((c) => (c.props.data as FrameData).size === null);
  history.run(on ? "Auto-fit frame" : "Manual frame size", [{ type: "updateNodes", changes }]);
  play(on ? "toggleOn" : "toggleOff", { volume: 0.6 });
}

export function setFrame(frame: CanvasNode, label: string, patch: Partial<FrameData>) {
  const d = frameData(frame.data);
  const next = { ...d, ...patch };
  if (JSON.stringify(next) !== JSON.stringify(d)) history.run(label, [update(frame, next)]);
}

export function setFrameColor(color: FrameColor) {
  play("button", { volume: 0.5 });
  const fs = selectedFrames();
  if (fs.length) history.run("Frame color", fs.map((f) => update(f, { ...frameData(f.data), color })));
}

/** A copied frame's member list, pointing at the copies (copy, paste, duplicate). */
export function remapFrame(node: CanvasNode, ids: Map<string, string>): CanvasNode {
  if (!isFrame(node)) return node;
  const d = frameData(node.data);
  return { ...node, data: { ...d, members: d.members.filter((id) => ids.has(id)).map((id) => ids.get(id)!) } };
}
