/**
 * A table node's content, stored in the node's `data` (design: ROADMAP "Table node").
 *
 * Columns each have a type: text, number, checkbox, or status (each status column has its own
 * states). Rows and
 * columns have ids; cells are keyed by both, so reordering never moves cell data. A status
 * cell holds a state id; an empty or unknown value shows as the column's first state.
 * Optional headings: a header row (the column names) and a header column (the row names).
 * Functions here work on plain data and mutate it in place; callers clone first.
 */

export type ColumnType = "text" | "number" | "checkbox" | "status";

/** A checkbox cell's value when ticked (unticked: no value). */
export const CHECKED = "1";

/** Named colors from the theme (app.css), plus a neutral gray. */
export type StateColor = "gray" | "red" | "orange" | "yellow" | "green" | "blue" | "purple";

export type TableState = {
  id: string;
  label: string;
  color: StateColor;
  /** One short symbol shown before the label (or alone), e.g. "✓". */
  symbol: string;
  /**
   * Counts as done for progress. When no state of a column says either way (older tables), the
   * column's last state is the done one.
   */
  done?: boolean;
};

export type TableColumn = {
  id: string;
  name: string;
  type: ColumnType;
  /** In em of the table's font, so widths scale with it. */
  width: number;
  /** Status columns: their states, in cycling order. */
  states?: TableState[];
  /** Status columns: show only the color (a compact heatmap look). */
  colorOnly?: boolean;
  /** Number columns: a total under the column. */
  total?: boolean;
};

export type TableRow = { id: string; name: string };

// A type alias, not an interface: node data is typed Record<string, unknown>.
export type TableData = {
  columns: TableColumn[];
  rows: TableRow[];
  /** "rowId:colId" → text, or a state id in status columns. */
  cells: Record<string, string>;
  headerRow: boolean;
  headerCol: boolean;
  /** World units; corner handles scale it, like a flowing card. */
  fontSize: number;
  /** Width of the header column (row names), in em. */
  headerWidth: number;
  /** Progress bars in the headings (status and checkbox columns). Absent: shown. */
  showProgress?: boolean;
};

export const STATE_COLORS: Record<StateColor, { color: string; label: string }> = {
  gray: { color: "var(--text-muted)", label: "Gray" },
  red: { color: "var(--c-red)", label: "Red" },
  orange: { color: "var(--c-orange)", label: "Orange" },
  yellow: { color: "var(--c-yellow)", label: "Yellow" },
  green: { color: "var(--c-green)", label: "Green" },
  blue: { color: "var(--c-blue)", label: "Blue" },
  purple: { color: "var(--c-purple)", label: "Purple" },
};

export const MIN_COL = 3;
export const MAX_COL = 40;
export const TEXT_COL = 8;
export const STATUS_COL = 8.5;
export const NUMBER_COL = 6;
export const CHECK_COL = 6.5;

const WIDTHS: Record<ColumnType, number> = { text: TEXT_COL, number: NUMBER_COL, checkbox: CHECK_COL, status: STATUS_COL };

const uid = () => crypto.randomUUID().slice(0, 8);
export const cellKey = (rowId: string, colId: string) => `${rowId}:${colId}`;

export function defaultStates(): TableState[] {
  return [
    { id: uid(), label: "Not started", color: "gray", symbol: "", done: false },
    { id: uid(), label: "In progress", color: "yellow", symbol: "…", done: false },
    { id: uid(), label: "Done", color: "green", symbol: "✓", done: true },
  ];
}

export function newColumn(type: ColumnType, name = "", states?: TableState[]): TableColumn {
  return type === "status"
    ? { id: uid(), name, type, width: STATUS_COL, states: (states ?? defaultStates()).map((s) => ({ ...s })) }
    : { id: uid(), name, type, width: WIDTHS[type] };
}

export const newRow = (name = ""): TableRow => ({ id: uid(), name });

/** A new 3×3 text table with both headings. */
export function newTable(fontSize = 16): TableData {
  return {
    columns: [newColumn("text", "Column 1"), newColumn("text", "Column 2"), newColumn("text", "Column 3")],
    rows: [newRow("Row 1"), newRow("Row 2"), newRow("Row 3")],
    cells: {},
    headerRow: true,
    headerCol: true,
    fontSize,
    headerWidth: TEXT_COL,
  };
}

export const DEFAULT_TABLE: TableData = {
  columns: [],
  rows: [],
  cells: {},
  headerRow: true,
  headerCol: true,
  fontSize: 16,
  headerWidth: TEXT_COL,
};

/** Table data with defaults filled in. */
export function tableData(data: unknown): TableData {
  const d = { ...DEFAULT_TABLE, ...(data as Partial<TableData> | null) };
  return {
    ...d,
    columns: Array.isArray(d.columns) ? d.columns : [],
    rows: Array.isArray(d.rows) ? d.rows : [],
    cells: d.cells && typeof d.cells === "object" ? d.cells : {},
  };
}

/** A status column's states (a default set if it somehow has none). */
export const statesOf = (c: TableColumn): TableState[] => (c.states?.length ? c.states : defaultStates());

/** The state a status cell shows: its own, or the column's first. */
export function stateOf(c: TableColumn, value: string | undefined): TableState {
  const states = statesOf(c);
  return states.find((s) => s.id === value) ?? states[0];
}

/** Whether a state counts as done: its own flag, else being its column's last state. */
export function isDoneState(c: TableColumn, s: TableState): boolean {
  const states = statesOf(c);
  return states.some((x) => x.done !== undefined) ? !!s.done : states[states.length - 1].id === s.id;
}

/** Whether a cell counts as done (status: a done state; checkbox: ticked); null if it doesn't count. */
export function cellDone(c: TableColumn, value: string | undefined): boolean | null {
  if (c.type === "checkbox") return value === CHECKED;
  if (c.type === "status") return isDoneState(c, stateOf(c, value));
  return null;
}

/** Done and total among cells that count (status and checkbox), for a row or a column. */
export function progressOf(d: TableData, cells: [TableRow, TableColumn][]): { done: number; total: number } {
  let done = 0, total = 0;
  for (const [r, c] of cells) {
    const v = cellDone(c, d.cells[cellKey(r.id, c.id)]);
    if (v === null) continue;
    total++;
    if (v) done++;
  }
  return { done, total };
}

/** Whether the table shows progress bars: it has columns that count, and they're not turned off. */
export const showsProgress = (d: TableData) => d.showProgress !== false && d.columns.some((c) => c.type === "status" || c.type === "checkbox");

/** A number cell's value, or null when its text isn't a number. */
export function numberOf(text: string | undefined): number | null {
  let t = (text ?? "").replace(/\s/g, "");
  if (!t) return null;
  // "1,5" is a decimal comma; "1,234" and "1,234.5" use commas between thousands.
  t = /^[-+]?\d+,\d{1,2}$/.test(t) ? t.replace(",", ".") : t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** A number column's total (cells that aren't numbers are left out). */
export function totalOf(d: TableData, c: TableColumn): number {
  return d.rows.reduce((sum, r) => sum + (numberOf(d.cells[cellKey(r.id, c.id)]) ?? 0), 0);
}

/** The next (or previous) state's id for a status cell. */
export function cycle(c: TableColumn, value: string | undefined, dir: 1 | -1): string {
  const states = statesOf(c);
  const i = Math.max(0, states.findIndex((s) => s.id === value));
  return states[(i + dir + states.length) % states.length].id;
}

/** The states a new status column starts with: those of the nearest status column to its left. */
export function inheritedStates(columns: TableColumn[], index: number): TableState[] | undefined {
  for (let i = Math.min(index, columns.length) - 1; i >= 0; i--) if (columns[i].type === "status") return statesOf(columns[i]);
  return undefined;
}

/** Inserts a column at `index` (a status column takes its states from the left). */
export function insertColumn(d: TableData, index: number, type: ColumnType = "text"): TableColumn {
  const col = newColumn(type, "", type === "status" ? inheritedStates(d.columns, index) : undefined);
  d.columns.splice(index, 0, col);
  return col;
}

export function insertRow(d: TableData, index: number): TableRow {
  const row = newRow();
  d.rows.splice(index, 0, row);
  return row;
}

export function removeColumn(d: TableData, colId: string) {
  d.columns = d.columns.filter((c) => c.id !== colId);
  for (const key of Object.keys(d.cells)) if (key.endsWith(`:${colId}`)) delete d.cells[key];
}

export function removeRow(d: TableData, rowId: string) {
  d.rows = d.rows.filter((r) => r.id !== rowId);
  for (const key of Object.keys(d.cells)) if (key.startsWith(`${rowId}:`)) delete d.cells[key];
}

const TRUTHY = /^(1|x|y|yes|true|done|✓|✔|☑)$/i;

/**
 * Changes a column's type, carrying values over: a status cell becomes its label as text or
 * number, ticked when its state is done as a checkbox; a checkbox becomes "✓", or the done
 * (else first) state; text becomes ticked when it reads like yes, a state when it matches a
 * state's label. Text stays text in a number column (it just doesn't add to the total).
 */
export function setColumnType(d: TableData, colId: string, type: ColumnType) {
  const i = d.columns.findIndex((c) => c.id === colId);
  const col = d.columns[i];
  if (!col || col.type === type) return;
  const states = type === "status" ? (inheritedStates(d.columns, i) ?? defaultStates()).map((s) => ({ ...s })) : [];
  const target: TableColumn = { ...col, type, states };
  const doneState = states.find((s) => isDoneState(target, s)) ?? states[states.length - 1];
  for (const row of d.rows) {
    const key = cellKey(row.id, colId);
    const v = d.cells[key];
    let next: string | undefined;
    if (col.type === "status") {
      const s = stateOf(col, v);
      next = type === "checkbox" ? (isDoneState(col, s) ? CHECKED : undefined) : s.label;
    } else if (col.type === "checkbox") {
      const on = v === CHECKED;
      next = type === "status" ? (on ? doneState.id : undefined) : on ? "✓" : undefined;
    } else if (type === "checkbox") next = v && TRUTHY.test(v.trim()) ? CHECKED : undefined;
    else if (type === "status") next = states.find((s) => s.label.toLowerCase() === (v ?? "").trim().toLowerCase())?.id;
    else next = v;
    if (next) d.cells[key] = next;
    else delete d.cells[key];
  }
  if (type === "status") col.states = states;
  else delete col.states;
  if (type !== "status") delete col.colorOnly;
  if (type !== "number") delete col.total;
  col.width = type === "text" || type === "number" ? Math.max(col.width, WIDTHS[type]) : WIDTHS[type];
  col.type = type;
}

/** A cell as text (status cells: their state's label; checkboxes: "✓" or nothing). */
export function cellText(d: TableData, row: TableRow, col: TableColumn): string {
  const v = d.cells[cellKey(row.id, col.id)];
  if (col.type === "status") return stateOf(col, v).label;
  if (col.type === "checkbox") return v === CHECKED ? "✓" : "";
  return v ?? "";
}

/** As a Markdown table, for other apps (copy). */
export function toMarkdown(d: TableData): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const head = [...(d.headerCol ? [""] : []), ...d.columns.map((c, i) => (d.headerRow ? c.name : "") || `Column ${i + 1}`)];
  const lines = [`| ${head.map(esc).join(" | ")} |`, `|${head.map(() => " --- ").join("|")}|`];
  for (const r of d.rows) {
    const cells = [...(d.headerCol ? [r.name] : []), ...d.columns.map((c) => cellText(d, r, c))];
    lines.push(`| ${cells.map(esc).join(" | ")} |`);
  }
  return lines.join("\n");
}

/** As CSV (RFC 4180: commas, quotes doubled, CRLF lines), for spreadsheets: the header row when shown. */
export function toCsv(d: TableData): string {
  const esc = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines: string[][] = [];
  if (d.headerRow) lines.push([...(d.headerCol ? [""] : []), ...d.columns.map((c) => c.name)]);
  for (const r of d.rows) lines.push([...(d.headerCol ? [r.name] : []), ...d.columns.map((c) => cellText(d, r, c))]);
  return lines.map((l) => l.map(esc).join(",")).join("\r\n") + "\r\n";
}

/**
 * A table from tab-separated text (pasted from a spreadsheet), or null if it doesn't look like
 * one: at least two lines and two columns. The first line becomes the header row.
 */
export function fromTsv(text: string, fontSize = 16): TableData | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2 || !lines.every((l) => l.includes("\t"))) return null;
  const grid = lines.map((l) => l.split("\t"));
  const width = Math.max(...grid.map((r) => r.length));
  if (width < 2 || width > 50 || grid.length > 500) return null;
  // A column whose values are all numbers comes in as a number column.
  const numeric = (ci: number) => {
    const values = grid.slice(1).map((r) => (r[ci] ?? "").trim()).filter(Boolean);
    return values.length > 0 && values.every((v) => numberOf(v) !== null);
  };
  const columns = Array.from({ length: width }, (_, i) => newColumn(numeric(i) ? "number" : "text", (grid[0][i] ?? "").trim()));
  const rows = grid.slice(1).map(() => newRow());
  const cells: Record<string, string> = {};
  grid.slice(1).forEach((r, ri) => r.forEach((v, ci) => v.trim() && (cells[cellKey(rows[ri].id, columns[ci].id)] = v.trim())));
  // Columns wide enough for their longest text (roughly: 0.55 em per character).
  for (const [ci, col] of columns.entries()) {
    const longest = Math.max(col.name.length, ...grid.map((r) => (r[ci] ?? "").trim().length));
    col.width = Math.min(24, Math.max(col.type === "number" ? NUMBER_COL : MIN_COL + 2, Math.ceil(longest * 0.55) + 1.5));
  }
  return { columns, rows, cells, headerRow: true, headerCol: false, fontSize, headerWidth: TEXT_COL };
}
