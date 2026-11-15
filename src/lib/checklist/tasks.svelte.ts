import { startEdit } from "../actions.svelte";
import { doc, selectOnly } from "../app.svelte";
import { play } from "../juice/sound";
import { flyToNode, inView } from "../outline/outline.svelte";
import { checklistUi, parentsOf } from "./state.svelte";
import type { CanvasNode } from "../doc/types";
import { settings } from "../settings.svelte";
import { checklistData, daysUntil, isDone, type TaskItem } from "./model";

/**
 * Every task on the board, for the side panel's Tasks tab. Leaf tasks are the rows (a parent is
 * just its children); parents show as a path hint, or as headers when grouped by checklist.
 */

export type TasksGroup = "due" | "checklist";
export type TasksFilter = "open" | "all" | "done";

export const GROUPS: [TasksGroup, string][] = [
  ["due", "By due date"],
  ["checklist", "By checklist"],
];
export const TASK_FILTERS: [TasksFilter, string][] = [
  ["open", "Open"],
  ["all", "All"],
  ["done", "Done"],
];

export interface TaskRef {
  node: CanvasNode;
  /** The checklist's title (or "Checklist"). */
  list: string;
  item: TaskItem;
  /** The texts of its parent tasks, outermost first. */
  path: string[];
  /** Ids of its parent tasks, outermost first. */
  parents: string[];
  done: boolean;
  /** Whole days until it's due (negative: overdue); null without a date. */
  days: number | null;
}

/** A row of the list: a section heading, a parent task (grouped by checklist), or a task. */
export type TaskRow =
  | { kind: "section"; key: string; label: string; count: number; tone?: "overdue" | "soon" }
  | { kind: "parent"; key: string; label: string; depth: number }
  | { kind: "task"; key: string; task: TaskRef; depth: number };

export const listName = (n: CanvasNode) => checklistData(n.data).title.trim() || "Checklist";

/** All leaf tasks of all checklists, in board order (checklists by the document's order). */
export function allTasks(): TaskRef[] {
  const out: TaskRef[] = [];
  const today = new Date();
  for (const node of doc.nodeList) {
    if (node.kind !== "checklist") continue;
    const list = listName(node);
    const walk = (items: TaskItem[], path: string[], parents: string[]) => {
      for (const item of items) {
        if (item.children.length) walk(item.children, [...path, item.text.trim() || "Task"], [...parents, item.id]);
        else out.push({ node, list, item, path, parents, done: isDone(item), days: item.due ? daysUntil(item.due, today) : null });
      }
    };
    walk(checklistData(node.data).items, [], []);
  }
  return out;
}

function matches(t: TaskRef, filter: TasksFilter, query: string) {
  if (filter === "open" && t.done) return false;
  if (filter === "done" && !t.done) return false;
  if (!query) return true;
  return `${t.item.text} ${t.path.join(" ")} ${t.list}`.toLowerCase().includes(query);
}

/** The tasks the current filter and a search let through, in board order. */
export function filteredTasks(query: string): TaskRef[] {
  const q = query.trim().toLowerCase();
  return allTasks().filter((t) => matches(t, settings.tasksFilter, q));
}

/** Selects a task's checklist, flies there if it's off-screen, and points the task out. */
export function showTask(t: TaskRef) {
  selectOnly([t.node.id]);
  if (!inView(t.node)) flyToNode(t.node.id);
  checklistUi.flash = { nodeId: t.node.id, itemId: t.item.id, key: (checklistUi.flash?.key ?? 0) + 1 };
  play("select", { volume: 0.4 });
}

/** Edits a task in its card, unfolding its parents (part of the edit) so it's in view. */
export function editTask(t: TaskRef) {
  if (!inView(t.node)) flyToNode(t.node.id);
  checklistUi.focus = { nodeId: t.node.id, itemId: t.item.id };
  startEdit(t.node.id);
  const node = doc.nodes[t.node.id];
  if (!node) return;
  const data = structuredClone(checklistData($state.snapshot(node.data)));
  const folded = new Set(parentsOf(data.items, t.item.id));
  let changed = false;
  const walk = (items: TaskItem[]) => {
    for (const it of items) {
      if (folded.has(it.id) && it.collapsed) {
        it.collapsed = false;
        changed = true;
      }
      walk(it.children);
    }
  };
  walk(data.items);
  if (changed) node.data = data;
}

/** Due-date sections, in order. */
const SECTIONS: { key: string; label: string; tone?: "overdue" | "soon" }[] = [
  { key: "overdue", label: "Overdue", tone: "overdue" },
  { key: "today", label: "Today", tone: "soon" },
  { key: "week", label: "Next 7 days" },
  { key: "later", label: "Later" },
  { key: "earlier", label: "Earlier" },
  { key: "none", label: "No date" },
];

/** Which due-date section a task goes in. A done task with a past date isn't overdue: "Earlier". */
function sectionOf(t: TaskRef): string {
  if (t.days === null) return "none";
  if (t.days < 0) return t.done ? "earlier" : "overdue";
  if (t.days === 0) return "today";
  return t.days <= 7 ? "week" : "later";
}

/** The rows to show for the current grouping, filter and search. */
export function taskRows(query: string): TaskRow[] {
  const q = query.trim().toLowerCase();
  const tasks = allTasks().filter((t) => matches(t, settings.tasksFilter, q));
  const rows: TaskRow[] = [];

  if (settings.tasksGroup === "due") {
    for (const s of SECTIONS) {
      // Soonest first; the stable sort keeps board order for the same day.
      const sorted = tasks.filter((t) => sectionOf(t) === s.key).sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
      if (!sorted.length) continue;
      rows.push({ kind: "section", key: s.key, label: s.label, count: sorted.length, tone: s.tone });
      for (const t of sorted) rows.push({ kind: "task", key: `${t.node.id}:${t.item.id}`, task: t, depth: 0 });
    }
    return rows;
  }

  // By checklist: a section per list, its parents as headers where they have shown tasks.
  const byList = new Map<string, TaskRef[]>();
  for (const t of tasks) byList.set(t.node.id, [...(byList.get(t.node.id) ?? []), t]);
  for (const [, list] of byList) {
    const first = list[0];
    rows.push({ kind: "section", key: first.node.id, label: first.list, count: list.length });
    let open: string[] = [];
    for (const t of list) {
      // Headers for the parents not already shown above this task.
      let shared = 0;
      while (shared < open.length && open[shared] === t.parents[shared]) shared++;
      for (let i = shared; i < t.parents.length; i++) {
        rows.push({ kind: "parent", key: `${t.node.id}:${t.parents[i]}`, label: t.path[i], depth: i });
      }
      open = t.parents;
      rows.push({ kind: "task", key: `${t.node.id}:${t.item.id}`, task: t, depth: t.parents.length });
    }
  }
  return rows;
}

/** Open tasks on the board (the tab's count). */
export const openCount = () => allTasks().filter((t) => !t.done).length;
