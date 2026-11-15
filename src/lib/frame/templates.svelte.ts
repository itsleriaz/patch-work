import { camera, doc, history, markFresh, selectedNodes, selectOnly } from "../app.svelte";
import { snap } from "../canvas/layout";
import { checklistData, type TaskItem } from "../checklist/model";
import { aabb, intersects, type Point } from "../doc/geometry";
import type { CanvasLink, CanvasNode } from "../doc/types";
import { play } from "../juice/sound";
import type { MenuEntry } from "../ui/Menu.svelte";
import { remapParent, withFamily } from "../parent/parents.svelte";
import { withFreeSlots } from "../pin/pins.svelte";
import { frameUi, remapFrame, withMembers } from "./frames.svelte";
import { frameData, isFrame } from "./model";

/**
 * Templates (2026-10-29, designed with the owner): any frame can be one. It stays on the board
 * as the master, edited like any frame; "New from template" stamps out a fresh copy of it with
 * its members (and their children and the links among them). Copies are independent: editing
 * the template later changes nothing already made. Fresh means checklist ticks start cleared;
 * the rest comes as it is, so placeholder text ("Name: …") works as a guide, and a placeholder
 * picture is swapped with Replace picture.
 */

export const isTemplate = (n: CanvasNode | undefined): boolean => !!n && isFrame(n) && !!frameData(n.data).template;

/** The board's templates, by title. */
export function templateList(): CanvasNode[] {
  return doc.nodeList.filter(isTemplate).sort((a, b) => templateName(a).localeCompare(templateName(b)));
}

export const templateName = (n: CanvasNode) => frameData(n.data).title.trim() || "Untitled template";

/** Marks the selected frames as templates, or unmarks them when they all are already. */
export function toggleTemplate() {
  const fs = selectedNodes().filter(isFrame);
  if (!fs.length) return;
  const on = !fs.every(isTemplate);
  history.run(on ? "Use as template" : "Stop using as template", [
    { type: "updateNodes", changes: fs.map((f) => ({ id: f.id, props: { data: { ...frameData($state.snapshot(f.data)), template: on || undefined } } })) },
  ]);
  play(on ? "toggleOn" : "toggleOff", { volume: 0.6 });
}

const untick = (items: TaskItem[]): TaskItem[] => items.map((t) => ({ ...t, done: false, children: untick(t.children) }));

/** A copy's content as it starts out: the same, with a checklist's ticks cleared. */
function fresh(n: CanvasNode): CanvasNode {
  if (n.kind === "checklist") return { ...n, data: { ...checklistData(n.data), items: untick(checklistData(n.data).items) } };
  if (isFrame(n)) return { ...n, data: { ...frameData(n.data), template: undefined } };
  return n;
}

/**
 * A fresh copy of a template. `at`: the world point its middle goes to; without one (the rail),
 * the middle of the view, or beside the template when that would land on it.
 */
export function stampTemplate(id: string, at?: Point) {
  const template = doc.nodes[id];
  if (!isTemplate(template)) return;
  const nodes = withFamily(withMembers([id])).map((i) => doc.nodes[i]).filter(Boolean).sort((a, b) => a.z - b.z);
  const box = aabb(template);
  let target = at ?? camera.toWorld(camera.centerX, camera.height / 2);
  const landing = { x: target.x - box.w / 2, y: target.y - box.h / 2, w: box.w, h: box.h };
  if (!at && intersects(landing, box)) target = { x: box.x + box.w * 1.5 + 40, y: box.y + box.h / 2 };
  const dx = snap(target.x - (box.x + box.w / 2)), dy = snap(target.y - (box.y + box.h / 2));

  let z = doc.maxZ();
  const ids = new Map(nodes.map((n) => [n.id, crypto.randomUUID()]));
  const copies = withFreeSlots(
    nodes.map((n) => fresh({ ...remapParent(remapFrame($state.snapshot(n) as CanvasNode, ids), ids), id: ids.get(n.id)!, x: n.x + dx, y: n.y + dy, z: ++z })),
  );
  const links: CanvasLink[] = doc
    .linksWithin(ids.keys())
    .map((l) => ({ ...($state.snapshot(l) as CanvasLink), id: crypto.randomUUID(), from: ids.get(l.from)!, to: ids.get(l.to)! }));
  history.run(`New ${templateName(template)}`, [
    { type: "addNodes", nodes: copies },
    { type: "addLinks", links },
  ]);
  const frame = ids.get(id)!;
  selectOnly([frame]);
  markFresh(copies.map((c) => c.id));
  // Named right away, like a new frame.
  frameUi.editing = frame;
  play("appear", { volume: 0.55 });
}

/** The templates as menu entries: each stamps a copy at `at` (the canvas menu's spot), or in view. */
export function templateEntries(at?: Point): MenuEntry[] {
  return templateList().map((t) => ({ label: templateName(t), run: () => stampTemplate(t.id, at) }));
}
