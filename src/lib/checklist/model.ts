/**
 * A checklist node's content: a tree of tasks, stored in the node's `data`.
 *
 * Only leaves keep their own `done`; a task with children is done when all of them are. Checking
 * a parent checks everything under it, and unchecking any task unchecks its parents (they're
 * derived). Functions here work on plain (non-reactive) data and mutate it in place; callers
 * clone first when the change goes through history.
 */

export interface TaskItem {
  id: string;
  text: string;
  /** Meaningful on leaves only. */
  done: boolean;
  children: TaskItem[];
  /** Its children are folded away (saved with the board). */
  collapsed?: boolean;
  /** Due date, a local calendar day: "YYYY-MM-DD". */
  due?: string | null;
}

// A type alias, not an interface: node data is typed Record<string, unknown>, which only
// accepts aliases.
export type ChecklistData = {
  title: string;
  /** World units; scales with the node, like a text card's. */
  fontSize: number;
  items: TaskItem[];
  /** Completed tasks are hidden (shown again while editing). */
  hideDone?: boolean;
};

export const DEFAULT_CHECKLIST: ChecklistData = { title: "", fontSize: 18, items: [], hideDone: false };

/** Checklist data with defaults filled in. */
export function checklistData(data: unknown): ChecklistData {
  const d = { ...DEFAULT_CHECKLIST, ...(data as Partial<ChecklistData> | null) };
  return { ...d, items: Array.isArray(d.items) ? d.items : [] };
}

export const newTask = (text = ""): TaskItem => ({ id: crypto.randomUUID(), text, done: false, children: [] });

export function isDone(t: TaskItem): boolean {
  return t.children.length ? t.children.every(isDone) : t.done;
}

/** Done and total tasks, counting leaves (a parent stands for its children). */
export function progress(items: TaskItem[]): { done: number; total: number } {
  let done = 0, total = 0;
  const walk = (list: TaskItem[]) => {
    for (const t of list) {
      if (t.children.length) walk(t.children);
      else {
        total++;
        if (t.done) done++;
      }
    }
  };
  walk(items);
  return { done, total };
}

export interface FlatRow {
  item: TaskItem;
  depth: number;
  parentId: string | null;
}

/**
 * The rows a checklist shows: reading order, without the children of collapsed tasks and, when
 * `hideDone`, without completed tasks (and what's under them). `skip` leaves out a task and
 * everything under it (the one being dragged).
 */
export function visibleRows(items: TaskItem[], hideDone: boolean, skip?: string): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (list: TaskItem[], depth: number, parentId: string | null) => {
    for (const item of list) {
      if (item.id === skip || (hideDone && isDone(item))) continue;
      out.push({ item, depth, parentId });
      if (!item.collapsed) walk(item.children, depth + 1, item.id);
    }
  };
  walk(items, 0, null);
  return out;
}

/** Tasks in reading order with their depth. `skip` leaves out a task and everything under it. */
export function flatten(items: TaskItem[], skip?: string): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (list: TaskItem[], depth: number, parentId: string | null) => {
    for (const item of list) {
      if (item.id === skip) continue;
      out.push({ item, depth, parentId });
      walk(item.children, depth + 1, item.id);
    }
  };
  walk(items, 0, null);
  return out;
}

export interface Location {
  /** The array holding the task, its index there, and its parent (null at the top level). */
  list: TaskItem[];
  index: number;
  parent: TaskItem | null;
}

export function locate(items: TaskItem[], id: string, parent: TaskItem | null = null): Location | null {
  for (let index = 0; index < items.length; index++) {
    if (items[index].id === id) return { list: items, index, parent };
    const found = locate(items[index].children, id, items[index]);
    if (found) return found;
  }
  return null;
}

export function findTask(items: TaskItem[], id: string): TaskItem | null {
  const at = locate(items, id);
  return at ? at.list[at.index] : null;
}

/** Removes a task (with its children) and returns it. */
export function removeTask(items: TaskItem[], id: string): TaskItem | null {
  const at = locate(items, id);
  return at ? at.list.splice(at.index, 1)[0] : null;
}

/** Inserts a task under `parentId` (null: the top level) at `index` among its siblings. */
export function insertTask(items: TaskItem[], parentId: string | null, index: number, task: TaskItem): boolean {
  const list = parentId === null ? items : findTask(items, parentId)?.children;
  if (!list) return false;
  list.splice(Math.max(0, Math.min(index, list.length)), 0, task);
  return true;
}

/** Moves a task (with its children). `index` counts the target's children without the moved task. */
export function moveTask(items: TaskItem[], id: string, parentId: string | null, index: number): boolean {
  if (parentId === id || (parentId && findTask(findTask(items, id)?.children ?? [], parentId))) return false;
  const task = removeTask(items, id);
  return !!task && insertTask(items, parentId, index, task);
}

/** Checks or unchecks a task and everything under it. */
export function setDone(t: TaskItem, done: boolean) {
  t.done = done;
  for (const c of t.children) setDone(c, done);
}

/** Toggles a task by its displayed state. Returns the new state. */
export function toggleTask(items: TaskItem[], id: string): boolean | null {
  const t = findTask(items, id);
  if (!t) return null;
  const done = !isDone(t);
  setDone(t, done);
  return done;
}

/** Makes a task the last child of the sibling above it. */
export function indentTask(items: TaskItem[], id: string): boolean {
  const at = locate(items, id);
  if (!at || at.index === 0) return false;
  const [task] = at.list.splice(at.index, 1);
  at.list[at.index - 1].children.push(task);
  return true;
}

/** Moves a task out of its parent, to just after it. */
export function outdentTask(items: TaskItem[], id: string): boolean {
  const at = locate(items, id);
  if (!at?.parent) return false;
  const parentAt = locate(items, at.parent.id);
  if (!parentAt) return false;
  const [task] = at.list.splice(at.index, 1);
  parentAt.list.splice(parentAt.index + 1, 0, task);
  return true;
}

/** Drops tasks with no text and no children (what's left after typing and deleting). */
export function pruneEmpty(items: TaskItem[]): TaskItem[] {
  return items
    .map((t) => ({ ...t, children: pruneEmpty(t.children) }))
    .filter((t) => t.text.trim() !== "" || t.children.length > 0);
}

/** Nothing typed: no title and no task text anywhere. */
export function isEmpty(data: ChecklistData): boolean {
  return data.title.trim() === "" && pruneEmpty(data.items).length === 0;
}

/** As a Markdown task list, for other apps (copy). */
export function toMarkdown(data: ChecklistData): string {
  const lines: string[] = data.title.trim() ? [`**${data.title.trim()}**`, ""] : [];
  for (const { item, depth } of flatten(data.items)) {
    const due = item.due ? ` (due ${item.due})` : "";
    lines.push(`${"  ".repeat(depth)}- [${isDone(item) ? "x" : " "}] ${item.text}${due}`);
  }
  return lines.join("\n");
}

/** A copy with fresh ids (pasting or duplicating shouldn't share task ids). */
export function withNewIds(items: TaskItem[]): TaskItem[] {
  return items.map((t) => ({ ...t, id: crypto.randomUUID(), children: withNewIds(t.children) }));
}

// ---------------------------------------------------------------- due dates

/** A local calendar day as "YYYY-MM-DD". */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A "YYYY-MM-DD" key as a local date (midnight). */
export function parseDay(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Whole days from `today` to a due day (negative: overdue). */
export function daysUntil(key: string, today = new Date()): number | null {
  const d = parseDay(key);
  if (!d) return null;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

/** "Today", "Tomorrow", "Yesterday", "Fri" (this week), "12 Oct", "12 Oct 2027". */
export function dueLabel(key: string, today = new Date()): string {
  const days = daysUntil(key, today);
  const d = parseDay(key);
  if (days === null || !d) return key;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

// ---------------------------------------------------------------- typed due dates

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Whether this system writes the day before the month (12/10 = 12 October). */
function dayFirst(): boolean {
  const parts = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "numeric" }).formatToParts(new Date(2020, 10, 22));
  return parts.findIndex((p) => p.type === "day") < parts.findIndex((p) => p.type === "month");
}

/** A day of `month` (0-based); next year if it has already passed this year. */
function upcoming(today: Date, month: number, day: number): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let d = new Date(t.getFullYear(), month, day);
  if (d.getMonth() !== month) return null; // e.g. 31 Feb
  if (d < t) d = new Date(t.getFullYear() + 1, month, day);
  return d;
}

/**
 * A due date typed as a word after "@" (without the "@"): today, tomorrow (tmr), a weekday (the
 * next one, today included), +3 / +3d / +2w, 12oct / oct12, 12/10 (in this system's day–month
 * order), 2026-10-12, or none (clears it). Returns the day key, null for "none", or undefined when
 * the word isn't a date.
 */
export function parseDueWord(word: string, today = new Date()): string | null | undefined {
  const w = word.toLowerCase().replace(/[.,;:!?]+$/, "");
  const at = (n: number) => dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));
  if (w === "none" || w === "nodate") return null;
  if (w === "today" || w === "tod") return at(0);
  if (w === "tomorrow" || w === "tmr" || w === "tom") return at(1);
  // "fri", "frid", "friday": at least three letters of a weekday's name.
  const weekday = w.length >= 3 ? WEEKDAYS.findIndex((d) => d.startsWith(w)) : -1;
  if (weekday >= 0) return at((weekday - today.getDay() + 7) % 7);
  let m = /^\+(\d{1,3})([dw]?)$/.exec(w);
  if (m) return at(Number(m[1]) * (m[2] === "w" ? 7 : 1));
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(w);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getMonth() === Number(m[2]) - 1 ? dayKey(d) : undefined;
  }
  const month = (s: string) => MONTHS.findIndex((mo) => s.startsWith(mo));
  const key = (d: Date | null) => (d ? dayKey(d) : undefined);
  m = /^(\d{1,2})([a-z]{3,9})$/.exec(w);
  if (m && month(m[2]) >= 0) return key(upcoming(today, month(m[2]), Number(m[1])));
  m = /^([a-z]{3,9})(\d{1,2})$/.exec(w);
  if (m && month(m[1]) >= 0) return key(upcoming(today, month(m[1]), Number(m[2])));
  m = /^(\d{1,2})[/.](\d{1,2})$/.exec(w);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const [day, mon] = dayFirst() ? [a, b] : [b, a];
    const d = upcoming(today, mon - 1, day);
    return d ? dayKey(d) : undefined;
  }
  return undefined;
}

/**
 * A task's text with a typed due date taken out: "@word" followed by a space (or, with
 * \`atEnd\`, at the very end). Returns the new text and the due date (null: clear it), or null
 * when there's none.
 */
export function takeDueWord(text: string, atEnd = false, today = new Date()): { text: string; due: string | null } | null {
  const m = (atEnd ? /(^|\s)@(\S+)\s*$/ : /(^|\s)@(\S+)\s$/).exec(text);
  if (!m) return null;
  const due = parseDueWord(m[2], today);
  if (due === undefined) return null;
  return { text: (text.slice(0, m.index) + m[1]).replace(/\s+$/, atEnd ? "" : " "), due };
}
