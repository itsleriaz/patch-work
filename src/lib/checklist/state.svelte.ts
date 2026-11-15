/** Checklist session state shared by the component, the drag code and the actions. */
import { doc, history, ui } from "../app.svelte";
import { play } from "../juice/sound";
import { checklistData, findTask, locate, toggleTask } from "./model";

/** Indentation per nesting level, in em of the checklist's font. Shared with ChecklistContent. */
export const INDENT_EM = 1.4;

/** Where a dragged task would land. */
export type TaskDropTarget =
  | {
      kind: "list";
      nodeId: string;
      parentId: string | null;
      /** Index among the parent's children (all of them, shown or not), not counting the dragged task. */
      index: number;
      depth: number;
      /** The drop line's offset from the top of the rows, in layout px (the card's own units). */
      lineTop: number;
    }
  | { kind: "canvas" }
  | { kind: "none" };

export interface TaskDrag {
  nodeId: string;
  itemId: string;
  text: string;
  /** Tasks under the dragged one, which travel with it. */
  extra: number;
  /** Client coordinates. */
  pointer: { x: number; y: number };
  /** Where the drag started and the task's depth then: depth changes by horizontal distance from here. */
  startX: number;
  startDepth: number;
  target: TaskDropTarget;
}

class ChecklistUi {
  drag = $state<TaskDrag | null>(null);
  /** A task input to focus once rendered: after entering edit mode, creating or moving a task. */
  focus = $state<{ nodeId: string; itemId: string | null; caret?: number | "end" } | null>(null);
  /** The due-date picker, open for a task, anchored at a point on screen (client px). */
  datePicker = $state<{ nodeId: string; itemId: string; x: number; y: number } | null>(null);
  /** A task row to point out for a moment (from the Tasks tab); `key` restarts it. */
  flash = $state<{ nodeId: string; itemId: string; key: number } | null>(null);
}
export const checklistUi = new ChecklistUi();

/** Checks or unchecks a task from outside its card (the Tasks tab), like its checkbox does. */
export function toggleTaskIn(nodeId: string, itemId: string) {
  const node = doc.nodes[nodeId];
  if (!node) return;
  const data = structuredClone(checklistData($state.snapshot(node.data)));
  const done = toggleTask(data.items, itemId);
  if (done === null) return;
  if (ui.editing?.id === nodeId) node.data = data;
  else history.run("Check task", [{ type: "updateNodes", changes: [{ id: nodeId, props: { data } }] }]);
  play(done ? "toggleOn" : "toggleOff", { volume: 0.55, pitch: done ? 1.1 : 0.95 });
}

/** The ids of a task's parents, outermost first. */
export function parentsOf(items: ReturnType<typeof checklistData>["items"], itemId: string): string[] {
  const out: string[] = [];
  let at = locate(items, itemId);
  while (at?.parent) {
    out.unshift(at.parent.id);
    at = locate(items, at.parent.id);
  }
  return out;
}

/**
 * Sets (or clears, with null) a task's due date. While the checklist is being edited it's part of
 * the edit (recorded when the edit ends); otherwise it's its own undo step.
 */
export function setDue(nodeId: string, itemId: string, due: string | null) {
  const node = doc.nodes[nodeId];
  if (!node) return;
  const data = structuredClone(checklistData($state.snapshot(node.data)));
  const task = findTask(data.items, itemId);
  if (!task || (task.due ?? null) === due) return;
  task.due = due;
  if (ui.editing?.id === nodeId) node.data = data;
  else history.run(due ? "Due date" : "Clear due date", [{ type: "updateNodes", changes: [{ id: nodeId, props: { data } }] }]);
  play("tap", { volume: 0.45, pitch: due ? 1.15 : 0.9 });
}
