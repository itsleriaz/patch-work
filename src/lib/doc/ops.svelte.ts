import type { Doc } from "./document.svelte";
import type { CanvasLink, CanvasNode } from "./types";

/**
 * Every document mutation is an Op. Ops are plain serializable data so they can
 * back undo/redo now and autosave or sync later. Applying an op returns its inverse.
 */
export type Op =
  | { type: "addNodes"; nodes: CanvasNode[] }
  /** Also removes the links touching these nodes; the inverse restores both. */
  | { type: "removeNodes"; ids: string[] }
  | { type: "updateNodes"; changes: NodeChange[] }
  /** Links whose ends don't exist are skipped. */
  | { type: "addLinks"; links: CanvasLink[] }
  | { type: "removeLinks"; ids: string[] }
  | { type: "updateLinks"; changes: LinkChange[] }
  /** Applied in order; its inverse applies the inverses in reverse. */
  | { type: "batch"; ops: Op[] };

export interface NodeChange {
  id: string;
  props: Partial<Omit<CanvasNode, "id">>;
}

export interface LinkChange {
  id: string;
  props: Partial<Omit<CanvasLink, "id">>;
}

/** Applies `props`, returning the previous values of the same keys. */
function patch<T extends object>(target: T, props: Partial<T>): Partial<T> {
  const old: Record<string, unknown> = {};
  for (const key of Object.keys(props)) old[key] = $state.snapshot(target[key as keyof T]);
  Object.assign(target, $state.snapshot(props));
  return old as Partial<T>;
}

export function applyOp(doc: Doc, op: Op): Op {
  switch (op.type) {
    case "addNodes": {
      for (const node of op.nodes) doc.nodes[node.id] = $state.snapshot(node);
      return { type: "removeNodes", ids: op.nodes.map((n) => n.id) };
    }
    case "removeNodes": {
      const links = applyOp(doc, { type: "removeLinks", ids: doc.linksOf(op.ids).map((l) => l.id) });
      const removed: CanvasNode[] = [];
      for (const id of op.ids) {
        const node = doc.nodes[id];
        if (!node) continue;
        removed.push($state.snapshot(node));
        delete doc.nodes[id];
      }
      const restore: Op = { type: "addNodes", nodes: removed };
      // Nodes come back first, then the links that attach to them.
      return links.type === "addLinks" && links.links.length ? { type: "batch", ops: [restore, links] } : restore;
    }
    case "updateNodes": {
      const previous: NodeChange[] = [];
      for (const { id, props } of op.changes) {
        const node = doc.nodes[id];
        if (node) previous.push({ id, props: patch(node, props) });
      }
      return { type: "updateNodes", changes: previous };
    }
    case "addLinks": {
      const added: string[] = [];
      for (const link of op.links) {
        if (!doc.nodes[link.from] || !doc.nodes[link.to]) continue;
        doc.links[link.id] = $state.snapshot(link);
        added.push(link.id);
      }
      return { type: "removeLinks", ids: added };
    }
    case "removeLinks": {
      const removed: CanvasLink[] = [];
      for (const id of op.ids) {
        const link = doc.links[id];
        if (!link) continue;
        removed.push($state.snapshot(link));
        delete doc.links[id];
      }
      return { type: "addLinks", links: removed };
    }
    case "updateLinks": {
      const previous: LinkChange[] = [];
      for (const { id, props } of op.changes) {
        const link = doc.links[id];
        if (link) previous.push({ id, props: patch(link, props) });
      }
      return { type: "updateLinks", changes: previous };
    }
    case "batch": {
      const inverses = op.ops.map((o) => applyOp(doc, o));
      return { type: "batch", ops: inverses.reverse() };
    }
  }
}
