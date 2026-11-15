import { doc, history, selectedNodes, selection, ui } from "../app.svelte";
import { fontSizeOf, isFlow, withFontSize } from "../canvas/flow";
import { frameOf, normalizeDeg, rotate } from "../doc/geometry";
import type { NodeChange, Op } from "../doc/ops.svelte";
import type { CanvasNode } from "../doc/types";
import { frames, reassign } from "../frame/frames.svelte";
import { isFrame } from "../frame/model";
import { play } from "../juice/sound";
import { isPin } from "../pin/model";
import { MAX_FONT, MIN_FONT } from "../text/palette";

/**
 * Parenting: a node attached to another (its parent) follows that node's moves, scaling and
 * turns, rigidly. Stored on the child (`parent`, an id); chains are allowed, cycles refused.
 * A parent that no longer exists counts as none, so deleting a parent needs no change to its
 * children and undoing the delete brings them back attached. Frames are never parents or children.
 * A family shares one frame: the root (the topmost ancestor) decides it (`familyTargets`).
 */

/** The node this one is attached to, if it exists. */
export function parentOf(n: CanvasNode): CanvasNode | undefined {
  const p = n.parent ? doc.nodes[n.parent] : undefined;
  return p && !isFrame(p) && p.id !== n.id ? p : undefined;
}

/** The topmost ancestor (the node itself when it has no parent). */
export function rootOf(n: CanvasNode): CanvasNode {
  const seen = new Set<string>();
  let r = n;
  for (let p = parentOf(r); p && !seen.has(p.id); p = parentOf(r)) {
    seen.add(r.id);
    r = p;
  }
  return r;
}

class Parents {
  /** Parent id → the ids of its children (existing nodes only). */
  children = $derived.by(() => {
    const m = new Map<string, string[]>();
    for (const n of doc.nodeList) {
      const p = parentOf(n);
      if (!p) continue;
      const list = m.get(p.id);
      if (list) list.push(n.id);
      else m.set(p.id, [n.id]);
    }
    return m;
  });
}
export const parents = new Parents();

/**
 * Everything hanging from a node, nearest first. `moving` leaves out locked nodes and what hangs
 * from them: a locked child stays where it is, so its own children stay with it.
 */
export function descendants(id: string, moving = false): string[] {
  const out: string[] = [];
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) {
    for (const c of parents.children.get(queue.shift()!) ?? []) {
      if (seen.has(c) || (moving && doc.nodes[c]?.locked)) continue;
      seen.add(c);
      out.push(c);
      queue.push(c);
    }
  }
  return out;
}

/** These ids plus everything hanging from them (what moves, copies or duplicates with them). */
export function withFamily(ids: Iterable<string>, moving = false): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    if (moving && doc.nodes[id]?.locked) continue;
    out.add(id);
    for (const d of descendants(id, moving)) out.add(d);
  }
  return [...out];
}

/** The whole families of these nodes: each one's root and everything hanging from it. */
export function familiesOf(nodes: CanvasNode[]): string[] {
  return withFamily(new Set(nodes.map((n) => rootOf(n).id)));
}

/**
 * Frame membership changes (see `reassign`) made to respect families: a node with a parent
 * can't change frames on its own (its entry is dropped), and a root takes its family along.
 */
export function familyTargets(targets: Map<string, string | null>): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const [id, target] of targets) {
    const n = doc.nodes[id];
    if (n && parentOf(n)) continue;
    out.set(id, target);
  }
  for (const [id, target] of [...out]) for (const d of descendants(id)) out.set(d, target);
  return out;
}

/**
 * A frame's member list made to respect families: a node whose root isn't in the list leaves it,
 * and a root brings everything hanging from it. Ids of deleted nodes are kept.
 */
export function familyMembers(ids: string[]): string[] {
  const listed = new Set(ids);
  const kept = ids.filter((id) => {
    const n = doc.nodes[id];
    return !n || listed.has(rootOf(n).id);
  });
  const out = new Set(kept);
  for (const id of kept) for (const d of descendants(id)) out.add(d);
  return [...out];
}

/**
 * Maps a node's children from its old box to its new one: positions follow the move, the turn
 * and the scale (each axis); sizes scale with it when it's uniform (a corner drag, native size),
 * and stay when only one side changed (a text card's width). Pins only move.
 */
function follower(before: CanvasNode, after: CanvasNode) {
  const b = frameOf(before), a = frameOf(after);
  const sx = b.w ? a.w / b.w : 1, sy = b.h ? a.h / b.h : 1;
  const k = Math.abs(sx - sy) < 1e-6 ? sx : 1;
  const turn = a.rotation - b.rotation;
  if (a.cx === b.cx && a.cy === b.cy && sx === 1 && sy === 1 && !turn) return null;
  return (m: CanvasNode): NodeChange["props"] => {
    const f = frameOf(m);
    const local = rotate({ x: f.cx - b.cx, y: f.cy - b.cy }, -b.rotation);
    const c = rotate({ x: local.x * sx, y: local.y * sy }, a.rotation);
    const pin = isPin(m);
    const w = pin ? m.w : m.w * k, h = pin ? m.h : m.h * k;
    const props: NodeChange["props"] = { x: a.cx + c.x - w / 2, y: a.cy + c.y - h / 2 };
    if (!pin && k !== 1) {
      props.w = w;
      props.h = h;
      if (isFlow(m)) props.data = withFontSize(m, Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(fontSizeOf(m) * k * 10) / 10)));
    }
    if (!pin && turn) props.rotation = normalizeDeg(m.rotation + turn);
    return props;
  };
}

/**
 * Node changes plus what they do to the changed nodes' children (and theirs), so moving, scaling
 * or turning a parent takes its children along. Nodes with changes of their own keep those;
 * locked nodes stay.
 */
export function carryChildren(changes: NodeChange[]): NodeChange[] {
  const changed = new Set(changes.map((c) => c.id));
  const out = [...changes];
  for (const c of changes) {
    const n = doc.nodes[c.id];
    if (!n || !parents.children.has(n.id)) continue;
    const follow = follower(n, { ...n, ...c.props } as CanvasNode);
    if (!follow) continue;
    for (const id of descendants(n.id, true)) {
      if (changed.has(id)) continue;
      changed.add(id);
      out.push({ id, props: follow(doc.nodes[id]) });
    }
  }
  return out;
}

/** A copied node's parent, pointing at the copy of it (none when its parent wasn't copied). */
export function remapParent(node: CanvasNode, ids: Map<string, string>): CanvasNode {
  if (!node.parent) return node;
  const { parent, ...rest } = node;
  const copy = ids.get(parent);
  return copy ? { ...rest, parent: copy } : rest;
}

// ---------------------------------------------------------------- commands

/** The node to attach to: the last one selected (with something else selected too). */
function attachTarget(): CanvasNode | undefined {
  const ids = [...selection.values()];
  return ids.length > 1 ? doc.nodes[ids[ids.length - 1]] : undefined;
}

export const canAttach = () => {
  const p = attachTarget();
  return !!p && !isFrame(p) && selectedNodes().some((n) => n.id !== p.id && !isFrame(n) && n.parent !== p.id);
};

/** Attaches the selected nodes to the last one selected, which joins them to its frame. */
export function attachToParent() {
  const p = attachTarget();
  if (!p || isFrame(p)) return;
  const children = selectedNodes().filter((n) => n.id !== p.id && !isFrame(n) && n.parent !== p.id);
  // A node can't hang from its own descendant.
  const ancestors = new Set<string>();
  for (let a: CanvasNode | undefined = p; a && !ancestors.has(a.id); a = parentOf(a)) ancestors.add(a.id);
  const ok = children.filter((n) => !ancestors.has(n.id));
  if (ok.length < children.length) ui.notify(ok.length ? "Skipped a node this one hangs from" : "Can't attach a node to its own child", "warn");
  if (!ok.length) return void play("denied", { volume: 0.5 });

  const frame = frames.owner.get(rootOf(p).id) ?? null;
  const moving = withFamily(ok.map((n) => n.id));
  const ops: Op[] = [
    { type: "updateNodes", changes: ok.map((n) => ({ id: n.id, props: { parent: p.id } })) },
    ...reassign(new Map(moving.filter((id) => (frames.owner.get(id) ?? null) !== frame).map((id) => [id, frame]))),
  ];
  history.run(ok.length > 1 ? `Attach ${ok.length} nodes` : "Attach to parent", ops);
  play("select", { volume: 0.6, pitch: 1.2 });
}

export const canDetach = () => selectedNodes().some((n) => !!parentOf(n));

/** Detaches the selected nodes from their parents (they stay where they are, in the same frame). */
export function detachFromParent() {
  const nodes = selectedNodes().filter((n) => !!parentOf(n));
  if (!nodes.length) return;
  const changes: NodeChange[] = nodes.map((n) => ({ id: n.id, props: { parent: undefined } }));
  history.run(nodes.length > 1 ? `Detach ${nodes.length} nodes` : "Detach from parent", [{ type: "updateNodes", changes }]);
  play("tap", { pitch: 0.85 });
}
