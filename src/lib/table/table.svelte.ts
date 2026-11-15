import { doc, history, markFresh, selectOnly, selection, ui } from "../app.svelte";
import { snap } from "../canvas/layout";
import type { Point } from "../doc/geometry";
import type { CanvasNode } from "../doc/types";
import { joinOps } from "../frame/frames.svelte";
import { play } from "../juice/sound";
import { isMac } from "../platform";
import type { MenuEntry } from "../ui/Menu.svelte";
import {
  cellKey,
  CHECKED,
  cycle,
  showsProgress,
  insertColumn,
  insertRow,
  newTable,
  removeColumn,
  removeRow,
  setColumnType,
  stateOf,
  tableData,
  type ColumnType,
  type TableData,
} from "./model";

/**
 * Table interaction: the selected cell, editing a cell, keyboard navigation, and the commands
 * behind the table's menus. Every document change goes through history; typing in a cell is
 * one step when the edit ends.
 *
 * Addresses: a row id, or HEAD for the header row; a column id, or HEAD for the header column
 * (the row names). The corner (HEAD, HEAD) is never a cell.
 */

export const HEAD = "head";

export interface CellRef {
  nodeId: string;
  rowId: string;
  colId: string;
}

class TableUi {
  /** The selected cell (its table is selected too). */
  cell = $state<CellRef | null>(null);
  /** The cell being typed into, and what it started with. */
  editing = $state<(CellRef & { initial: string }) | null>(null);
  /** The state picker for a status cell, at a point on screen (client px). */
  picker = $state<(CellRef & { x: number; y: number }) | null>(null);
  /** The states editor for a status column, at a point on screen. */
  statesEditor = $state<{ nodeId: string; colId: string; x: number; y: number } | null>(null);
  /** A cell to point out for a moment (from search); `key` restarts it. */
  flash = $state<(CellRef & { key: number }) | null>(null);
}
export const tableUi = new TableUi();

const same = (a: CellRef | null, b: CellRef) => !!a && a.nodeId === b.nodeId && a.rowId === b.rowId && a.colId === b.colId;
export const isCell = (ref: CellRef | null, nodeId: string, rowId: string, colId: string) => same(ref, { nodeId, rowId, colId });

function dataOf(nodeId: string): TableData | null {
  const n = doc.nodes[nodeId];
  return n?.kind === "table" ? structuredClone(tableData($state.snapshot(n.data))) : null;
}

/** Applies a change to a table as one undo step. Returns false if nothing changed. */
export function change(nodeId: string, label: string, fn: (d: TableData) => void): boolean {
  const before = dataOf(nodeId);
  if (!before) return false;
  const d = structuredClone(before);
  fn(d);
  if (JSON.stringify(d) === JSON.stringify(before)) return false;
  history.run(label, [{ type: "updateNodes", changes: [{ id: nodeId, props: { data: d } }] }]);
  return true;
}

// ---------------------------------------------------------------- cells

/** The cell's text: a header's name, or a text cell's content ("" for status cells). */
export function textAt(d: TableData, rowId: string, colId: string): string {
  if (rowId === HEAD) return d.columns.find((c) => c.id === colId)?.name ?? "";
  if (colId === HEAD) return d.rows.find((r) => r.id === rowId)?.name ?? "";
  return d.cells[cellKey(rowId, colId)] ?? "";
}

/** Status and checkbox cells change by clicking, not typing. */
const isStatus = (d: TableData, ref: CellRef) => {
  const type = ref.rowId !== HEAD ? d.columns.find((c) => c.id === ref.colId)?.type : undefined;
  return type === "status" || type === "checkbox";
};

export function selectCell(ref: CellRef) {
  if (!selection.has(ref.nodeId) || selection.size > 1) selectOnly([ref.nodeId]);
  tableUi.cell = ref;
}

/** Starts typing into a cell (status cells have no text). `initial` replaces the content. */
export function editCell(ref: CellRef, initial?: string) {
  const d = dataOf(ref.nodeId);
  if (!d || isStatus(d, ref)) return;
  selectCell(ref);
  tableUi.editing = { ...ref, initial: initial ?? textAt(d, ref.rowId, ref.colId) };
}

/** Ends typing: writes the text as one undo step (a header renames its row or column). */
export function commitCell(value: string) {
  const e = tableUi.editing;
  if (!e) return;
  tableUi.editing = null;
  const text = value.replace(/\s+$/, "");
  change(e.nodeId, e.rowId === HEAD ? "Rename column" : e.colId === HEAD ? "Rename row" : "Edit cell", (d) => {
    if (e.rowId === HEAD) {
      const c = d.columns.find((c) => c.id === e.colId);
      if (c) c.name = text;
    } else if (e.colId === HEAD) {
      const r = d.rows.find((r) => r.id === e.rowId);
      if (r) r.name = text;
    } else if (text) d.cells[cellKey(e.rowId, e.colId)] = text;
    else delete d.cells[cellKey(e.rowId, e.colId)];
  });
}

export const cancelCell = () => (tableUi.editing = null);

/** Steps a status cell to its next (or previous) state, or toggles a checkbox, as one undo step. */
export function cycleCell(ref: CellRef, dir: 1 | -1) {
  let ticked: boolean | null = null;
  change(ref.nodeId, "Change state", (d) => {
    const col = d.columns.find((c) => c.id === ref.colId);
    const key = cellKey(ref.rowId, ref.colId);
    if (col?.type === "status") d.cells[key] = cycle(col, d.cells[key], dir);
    else if (col?.type === "checkbox") {
      ticked = d.cells[key] !== CHECKED;
      if (ticked) d.cells[key] = CHECKED;
      else delete d.cells[key];
    }
  });
  if (ticked === null) play("tap", { volume: 0.45, pitch: dir > 0 ? 1.15 : 0.9 });
  else play(ticked ? "toggleOn" : "toggleOff", { volume: 0.5 });
}

export function setState(ref: CellRef, stateId: string) {
  change(ref.nodeId, "Change state", (d) => (d.cells[cellKey(ref.rowId, ref.colId)] = stateId));
  play("tap", { volume: 0.45, pitch: 1.1 });
}

/** Empties a text cell, or puts a status cell back to its first state. */
export function clearCell(ref: CellRef) {
  if (ref.rowId === HEAD || ref.colId === HEAD) return;
  change(ref.nodeId, "Clear cell", (d) => delete d.cells[cellKey(ref.rowId, ref.colId)]);
}

// ---------------------------------------------------------------- moving around

/** The addressable rows and columns, in order (with the headings when shown). */
function axes(d: TableData) {
  return {
    rows: [...(d.headerRow ? [HEAD] : []), ...d.rows.map((r) => r.id)],
    cols: [...(d.headerCol ? [HEAD] : []), ...d.columns.map((c) => c.id)],
  };
}

/** Moves the selected cell; the heading corner is skipped. Returns false at an edge. */
function move(ref: CellRef, dr: number, dc: number): boolean {
  const d = dataOf(ref.nodeId);
  if (!d) return false;
  const { rows, cols } = axes(d);
  let r = rows.indexOf(ref.rowId) + dr, c = cols.indexOf(ref.colId) + dc;
  if (rows[r] === HEAD && cols[c] === HEAD) {
    if (dc) c += dc;
    else r += dr;
  }
  if (r < 0 || r >= rows.length || c < 0 || c >= cols.length) return false;
  selectCell({ nodeId: ref.nodeId, rowId: rows[r], colId: cols[c] });
  return true;
}

/** Tab: the next cell, wrapping to the next row; past the last cell, a new row. */
function next(ref: CellRef, dir: 1 | -1) {
  const d = dataOf(ref.nodeId);
  if (!d) return;
  if (move(ref, 0, dir)) return;
  const { rows, cols } = axes(d);
  const r = rows.indexOf(ref.rowId) + dir;
  if (r >= 0 && r < rows.length) {
    const c = dir > 0 ? cols.find((id) => !(rows[r] === HEAD && id === HEAD))! : cols[cols.length - 1];
    selectCell({ nodeId: ref.nodeId, rowId: rows[r], colId: c });
  } else if (dir > 0) {
    let added = "";
    change(ref.nodeId, "Add row", (t) => (added = insertRow(t, t.rows.length).id));
    play("appear", { volume: 0.5 });
    selectCell({ nodeId: ref.nodeId, rowId: added, colId: cols.find((id) => id !== HEAD)! });
  }
}

/**
 * Keys for the selected cell, before the app's shortcuts (App.svelte). Arrows and Tab move;
 * Enter or F2 edits (a status cell: cycles, Shift: back); Delete or Backspace (or X on a status
 * cell) clears; typing starts editing with that character; Esc leaves the cell. Space is the pan
 * key, so a tap of it cycles through `tapSpace` (App.svelte), not here.
 * Returns true when it handled the key.
 */
export function handleTableKey(e: KeyboardEvent): boolean {
  const ref = tableUi.cell;
  if (!ref || tableUi.editing || ui.menu || !selection.has(ref.nodeId) || selection.size > 1) return false;
  const d = dataOf(ref.nodeId);
  if (!d) return false;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod || e.altKey) return false;
  const status = isStatus(d, ref);
  const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

  if (arrows[e.key]) move(ref, ...arrows[e.key]);
  else if (e.key === "Tab" || e.code === "Tab") next(ref, e.shiftKey ? -1 : 1);
  else if (e.key === "Escape") tableUi.cell = null;
  else if (status && e.key === "Enter") cycleCell(ref, e.shiftKey ? -1 : 1);
  else if (e.key === "Enter" || e.key === "F2") editCell(ref);
  // X deletes on the canvas; here it clears like Delete (a text cell takes it as typing, below).
  else if (e.key === "Delete" || e.key === "Backspace" || (status && e.key.toLowerCase() === "x")) clearCell(ref);
  else if (e.key.length === 1 && !status) editCell(ref, e.key);
  else return false;
  e.preventDefault();
  return true;
}

// ---------------------------------------------------------------- creating

/** A new 3×3 table at `at`, its first cell selected. */
export function createTable(at: Point) {
  const data = newTable();
  const node: CanvasNode = {
    id: crypto.randomUUID(),
    kind: "table",
    assetId: null,
    x: snap(at.x - 200),
    y: snap(at.y - 60),
    w: 400,
    h: 120,
    rotation: 0,
    z: doc.maxZ() + 1,
    data,
  };
  history.run("Add table", [{ type: "addNodes", nodes: [node] }, ...joinOps([node], at)]);
  markFresh([node.id]);
  selectCell({ nodeId: node.id, rowId: data.rows[0].id, colId: data.columns[0].id });
}

/** A table node made from data (a spreadsheet paste), centered on `at`. */
export function placeTable(data: TableData, at: Point, label = "Paste table") {
  const w = (data.columns.reduce((s, c) => s + c.width, 0) + (data.headerCol ? data.headerWidth : 0)) * data.fontSize;
  const h = (data.rows.length + 1) * data.fontSize * 2;
  const node: CanvasNode = {
    id: crypto.randomUUID(),
    kind: "table",
    assetId: null,
    x: snap(at.x - w / 2),
    y: snap(at.y - h / 2),
    w,
    h,
    rotation: 0,
    z: doc.maxZ() + 1,
    data,
  };
  history.run(label, [{ type: "addNodes", nodes: [node] }, ...joinOps([node], at)]);
  selectOnly([node.id]);
  markFresh([node.id]);
}

// ---------------------------------------------------------------- the cell menu

/** The context menu for a cell (or heading): rows, columns, column type, states, headings. */
export function cellMenu(ref: CellRef): MenuEntry[] {
  const d = dataOf(ref.nodeId);
  if (!d) return [];
  const id = ref.nodeId;
  const ri = d.rows.findIndex((r) => r.id === ref.rowId);
  const ci = d.columns.findIndex((c) => c.id === ref.colId);
  const col = ci >= 0 ? d.columns[ci] : undefined;
  const added = (what: string) => play("appear", { volume: 0.5, pitch: what === "row" ? 1 : 1.1 });
  const entries: MenuEntry[] = [];

  if (ref.rowId !== HEAD) {
    entries.push(
      { label: "Insert row above", run: () => (change(id, "Add row", (t) => insertRow(t, ri)), added("row")) },
      { label: "Insert row below", run: () => (change(id, "Add row", (t) => insertRow(t, ri + 1)), added("row")) },
    );
  }
  if (ref.colId !== HEAD) {
    entries.push(
      { label: "Insert column left", run: () => (change(id, "Add column", (t) => insertColumn(t, ci, col?.type)), added("col")) },
      { label: "Insert column right", run: () => (change(id, "Add column", (t) => insertColumn(t, ci + 1, col?.type)), added("col")) },
    );
  }
  entries.push("-");
  if (ref.rowId !== HEAD && d.rows.length > 1) {
    entries.push({ label: "Delete row", run: () => (change(id, "Delete row", (t) => removeRow(t, ref.rowId)), (tableUi.cell = null), play("vanish", { volume: 0.5 })) });
  }
  if (col && d.columns.length > 1) {
    entries.push({ label: "Delete column", run: () => (change(id, "Delete column", (t) => removeColumn(t, col.id)), (tableUi.cell = null), play("vanish", { volume: 0.5 })) });
  }
  if (col) {
    const setType = (type: ColumnType) => change(id, `Make ${type} column`, (t) => setColumnType(t, col.id, type));
    entries.push("-", {
      label: "Column type",
      items: () => [
        { label: "Text", checked: col.type === "text", run: () => setType("text") },
        { label: "Number", checked: col.type === "number", run: () => setType("number") },
        { label: "Checkbox", checked: col.type === "checkbox", run: () => setType("checkbox") },
        { label: "Status", checked: col.type === "status", run: () => setType("status") },
      ],
    });
    if (col.type === "number") {
      entries.push({ label: "Show total", checked: !!col.total, run: () => change(id, "Column total", (t) => { const c = t.columns.find((c) => c.id === col.id); if (c) c.total = !c.total; }) });
    }
    if (col.type === "status") {
      entries.push(
        { label: "Edit states…", run: () => openStatesEditor(id, col.id) },
        { label: "Colors only", checked: !!col.colorOnly, run: () => change(id, "Status display", (t) => { const c = t.columns.find((c) => c.id === col.id); if (c) c.colorOnly = !c.colorOnly; }) },
      );
    }
  }
  if (ref.rowId !== HEAD && ref.colId !== HEAD) entries.push({ label: "Clear cell", run: () => clearCell(ref) });
  entries.push(
    "-",
    { label: "Header row", checked: d.headerRow, run: () => change(id, "Header row", (t) => (t.headerRow = !t.headerRow)) },
    { label: "Header column", checked: d.headerCol, run: () => change(id, "Header column", (t) => (t.headerCol = !t.headerCol)) },
    ...(d.columns.some((c) => c.type === "status" || c.type === "checkbox")
      ? [{ label: "Show progress", checked: showsProgress(d), run: () => change(id, "Show progress", (t) => (t.showProgress = !showsProgress(t))) }]
      : []),
    "-",
    "copy",
    "duplicate",
    "delete",
  );
  return entries;
}

/** Opens the states editor for a status column, near its header cell on screen. */
export function openStatesEditor(nodeId: string, colId: string) {
  const el = document.querySelector(`[data-node-id="${nodeId}"] [data-cell="${HEAD}:${colId}"]`) ?? document.querySelector(`[data-node-id="${nodeId}"]`);
  const r = el?.getBoundingClientRect();
  tableUi.statesEditor = { nodeId, colId, x: r ? r.left : 200, y: r ? r.bottom + 6 : 200 };
}

/** The state a status cell shows (for the picker's check mark). */
export function stateIdAt(ref: CellRef): string | null {
  const d = dataOf(ref.nodeId);
  const col = d?.columns.find((c) => c.id === ref.colId);
  return d && col?.type === "status" ? stateOf(col, d.cells[cellKey(ref.rowId, ref.colId)]).id : null;
}

/** Moves from a cell (after typing: Enter goes down, Tab across). */
export const moveCell = (ref: CellRef, dr: number, dc: number) => move(ref, dr, dc);
export const nextCell = (ref: CellRef, dir: 1 | -1) => next(ref, dir);

/** A tap of Space (not held to pan): cycles the selected status cell (Shift: back). */
export function tapSpace(back: boolean) {
  const ref = tableUi.cell;
  if (!ref || tableUi.editing || !selection.has(ref.nodeId)) return;
  const d = dataOf(ref.nodeId);
  if (d && isStatus(d, ref)) cycleCell(ref, back ? -1 : 1);
}
