import { camera, doc, history, markFresh, selectOnly, ui } from "../app.svelte";
import { commitEdit } from "../actions.svelte";
import { snap } from "../canvas/layout";
import type { Op } from "../doc/ops.svelte";
import type { CanvasNode } from "../doc/types";
import { joinOps } from "../frame/frames.svelte";
import { play } from "../juice/sound";
import { checklistData, findTask, flatten, insertTask, removeTask, visibleRows, withNewIds, type ChecklistData } from "./model";
import { checklistUi, INDENT_EM, type TaskDrag, type TaskDropTarget } from "./state.svelte";

/** Starts dragging a task by its grip. */
export function startTaskDrag(e: PointerEvent, nodeId: string, itemId: string) {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  if (ui.editing) commitEdit();
  const node = doc.nodes[nodeId];
  const items = node ? checklistData(node.data).items : [];
  const task = findTask(items, itemId);
  if (!task) return;

  checklistUi.drag = {
    nodeId,
    itemId,
    text: task.text,
    extra: flatten(task.children).length,
    pointer: { x: e.clientX, y: e.clientY },
    startX: e.clientX,
    startDepth: flatten(items).find((r) => r.item.id === itemId)?.depth ?? 0,
    target: { kind: "none" },
  };
  play("tap", { pitch: 1.2 });

  const move = (ev: PointerEvent) => {
    const drag = checklistUi.drag;
    if (!drag) return;
    const target = dropTarget(drag, ev.clientX, ev.clientY);
    if (target.kind !== drag.target.kind || (target.kind === "list" && drag.target.kind === "list" && (target.lineTop !== drag.target.lineTop || target.depth !== drag.target.depth))) {
      play("tap", { volume: 0.3, throttle: 40, pitch: 1.1 });
    }
    checklistUi.drag = { ...drag, pointer: { x: ev.clientX, y: ev.clientY }, target };
  };
  const end = (ev: PointerEvent | KeyboardEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("keydown", cancel, true);
    const drag = checklistUi.drag;
    checklistUi.drag = null;
    if (drag && ev.type === "pointerup") drop(drag);
  };
  const cancel = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    end(ev);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("keydown", cancel, true);
}

/** The checklist row slot under the pointer, its nesting depth by horizontal position, or the canvas. */
function dropTarget(drag: TaskDrag, x: number, y: number): TaskDropTarget {
  const els = document.elementsFromPoint(x, y);
  const list = els.find((el) => el instanceof HTMLElement && el.dataset.checklist) as HTMLElement | undefined;
  if (!list) return els.some((el) => el.classList.contains("viewport")) ? { kind: "canvas" } : { kind: "none" };

  const nodeId = list.dataset.checklist!;
  const node = doc.nodes[nodeId];
  const rowsEl = list.querySelector<HTMLElement>("[data-rows]");
  if (!node || !rowsEl) return { kind: "none" };
  // The rows as shown (folded children and hidden completed tasks left out), like the DOM rows.
  const data = checklistData(node.data);
  const flat = visibleRows(data.items, !!data.hideDone, nodeId === drag.nodeId ? drag.itemId : undefined);
  const rowEls = new Map([...rowsEl.querySelectorAll<HTMLElement>("[data-task-row]")].map((el) => [el.dataset.itemId!, el]));

  // The slot: before the first row whose middle is below the pointer.
  let index = flat.length;
  for (let i = 0; i < flat.length; i++) {
    const r = rowEls.get(flat[i].item.id)?.getBoundingClientRect();
    if (r && y < r.top + r.height / 2) {
      index = i;
      break;
    }
  }
  // The depth: the task's own, plus one per indent the pointer has moved right (minus per left),
  // within what the neighbours allow. Dragging straight up or down keeps the level.
  const indentPx = parseFloat(getComputedStyle(list).fontSize) * camera.zoom * INDENT_EM;
  const wanted = drag.startDepth + Math.round((x - drag.startX) / indentPx);
  const max = index > 0 ? flat[index - 1].depth + 1 : 0;
  const min = index < flat.length ? flat[index].depth : 0;
  const depth = Math.max(min, Math.min(max, wanted));

  // The parent is the nearest row above at one level up; the index counts its children above.
  let parentId: string | null = null;
  if (depth > 0) {
    for (let k = index - 1; k >= 0; k--) {
      if (flat[k].depth === depth - 1) {
        parentId = flat[k].item.id;
        break;
      }
    }
  }
  // The index among all the parent's children, shown or not: before the sibling at the slot, or
  // after the nearest sibling above it, or first.
  const siblings = (parentId === null ? data.items : (findTask(data.items, parentId)?.children ?? [])).filter((t) => t.id !== drag.itemId);
  const same = (r: (typeof flat)[number] | undefined) => !!r && r.depth === depth && r.parentId === parentId;
  const above = flat.slice(0, index).reverse().find(same);
  const childIndex = same(flat[index])
    ? siblings.findIndex((t) => t.id === flat[index].item.id)
    : above
      ? siblings.findIndex((t) => t.id === above.item.id) + 1
      : 0;

  // The line sits on top of the slot's row, or under the last row.
  const after = index < flat.length ? rowEls.get(flat[index].item.id) : null;
  const before = index > 0 ? rowEls.get(flat[index - 1].item.id) : null;
  const lineTop = after ? after.offsetTop : before ? before.offsetTop + before.offsetHeight : 0;
  return { kind: "list", nodeId, parentId, index: childIndex, depth, lineTop };
}

const plain = (n: CanvasNode): ChecklistData => structuredClone(checklistData($state.snapshot(n.data)));

/** Moves the dragged task to its target, as one undo step. */
function drop(drag: TaskDrag) {
  const source = doc.nodes[drag.nodeId];
  const target = drag.target;
  if (!source || target.kind === "none") return;
  const from = plain(source);
  const task = removeTask(from.items, drag.itemId);
  if (!task) return;
  const label = drag.extra ? "Move tasks" : "Move task";
  // An untitled checklist emptied by dragging its last task away goes with it (same undo step).
  const leave = (): Op[] =>
    from.items.length === 0 && !from.title.trim()
      ? [{ type: "removeNodes", ids: [source.id] }]
      : [{ type: "updateNodes", changes: [{ id: source.id, props: { data: from } }] }];

  const unfold = (items: ChecklistData["items"], parentId: string | null) => {
    const parent = parentId ? findTask(items, parentId) : null;
    if (parent?.collapsed) parent.collapsed = false;
  };
  if (target.kind === "list" && target.nodeId === source.id) {
    insertTask(from.items, target.parentId, target.index, task);
    unfold(from.items, target.parentId);
    if (JSON.stringify(from) === JSON.stringify(checklistData($state.snapshot(source.data)))) return;
    history.run(label, [{ type: "updateNodes", changes: [{ id: source.id, props: { data: from } }] }]);
  } else if (target.kind === "list") {
    const other = doc.nodes[target.nodeId];
    if (!other) return;
    const to = plain(other);
    // Ids only need to be unique within a list; a duplicated list shares them.
    insertTask(to.items, target.parentId, target.index, withNewIds([task])[0]);
    unfold(to.items, target.parentId);
    history.run(label, [{ type: "updateNodes", changes: [{ id: other.id, props: { data: to } }] }, ...leave()]);
  } else {
    // Onto empty canvas: a new checklist with the task, where it was dropped.
    const viewport = document.querySelector(".viewport")!.getBoundingClientRect();
    const at = camera.toWorld(drag.pointer.x - viewport.left, drag.pointer.y - viewport.top);
    const node: CanvasNode = {
      id: crypto.randomUUID(),
      kind: "checklist",
      assetId: null,
      x: snap(at.x - 20),
      y: snap(at.y - 20),
      w: source.w,
      h: 80,
      rotation: 0,
      z: doc.maxZ() + 1,
      data: { ...from, title: "", items: [task] },
    };
    history.run("New checklist", [...leave(), { type: "addNodes", nodes: [node] }, ...joinOps([node], at)]);
    selectOnly([node.id]);
    markFresh([node.id]);
  }
  play("button", { volume: 0.5, pitch: 0.95 });
}
