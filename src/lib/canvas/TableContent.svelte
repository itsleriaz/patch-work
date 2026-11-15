<script lang="ts">
  import { fitSize } from "./flow";
  import { tip } from "../ui/tips.svelte";
  import { Check, Plus } from "@lucide/svelte";
  import { camera, history, selection, ui } from "../app.svelte";
  import type { CanvasNode } from "../doc/types";
  import { play } from "../juice/sound";
  import {
    cellKey,
    CHECKED,
    insertColumn,
    insertRow,
    MAX_COL,
    MIN_COL,
    numberOf,
    progressOf,
    showsProgress,
    STATE_COLORS,
    stateOf,
    tableData,
    totalOf,
    type TableColumn,
    type TableRow,
  } from "../table/model";
  import {
    cancelCell,
    change,
    commitCell,
    cycleCell,
    editCell,
    HEAD,
    isCell,
    moveCell,
    nextCell,
    selectCell,
    tableUi,
    type CellRef,
  } from "../table/table.svelte";

  /**
   * A table: a grid of cells with optional headings (a header row of column names and a header
   * column of row names). Text cells are typed into; status cells cycle through their column's
   * states on click (Shift: back) and open a picker on right-click. Its size follows its content
   * (column widths in em, rows as tall as their text), written to the node like a text card's
   * height. Hover effects are paint-only: no opacity or transform animations (HANDOFF §8).
   */

  let { node }: { node: CanvasNode } = $props();

  const d = $derived(tableData(node.data));
  const selected = $derived(selection.has(node.id));
  const columns = $derived(`${d.headerCol ? `${d.headerWidth}em ` : ""}${d.columns.map((c) => `${c.width}em`).join(" ")}`);

  // Progress in the headings: done out of the cells that count (status and checkbox).
  const progress = $derived(showsProgress(d));
  const counts = (c: TableColumn) => c.type === "status" || c.type === "checkbox";
  const rowProgress = (r: TableRow) => progressOf(d, d.columns.filter(counts).map((c) => [r, c]));
  const colProgress = (c: TableColumn) => (counts(c) ? progressOf(d, d.rows.map((r) => [r, c])) : null);
  // A totals row when a number column asks for one.
  const totals = $derived(d.columns.some((c) => c.type === "number" && c.total));
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  let box: HTMLDivElement;

  // Size follows the content. Layout size is unaffected by the camera's scale.
  $effect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const size = entry.borderBoxSize[0];
      const w = size?.inlineSize ?? box.offsetWidth, h = size?.blockSize ?? box.offsetHeight;
      const dw = w > 0 && Math.abs(w - node.w) > 0.5, dh = h > 0 && Math.abs(h - node.h) > 0.5;
      if (dw || dh) fitSize(node, dw ? w : node.w, dh ? h : node.h);
    });
    observer.observe(box);
    return () => observer.disconnect();
  });

  // Deselecting the table (or deleting it) leaves its cell.
  $effect(() => {
    if (!selected && tableUi.cell?.nodeId === node.id) tableUi.cell = null;
    if (!selected && tableUi.editing?.nodeId === node.id) tableUi.editing = null;
  });

  const ref = (rowId: string, colId: string): CellRef => ({ nodeId: node.id, rowId, colId });
  const at = (rowId: string, colId: string) => isCell(tableUi.cell, node.id, rowId, colId);
  const typing = (rowId: string, colId: string) => isCell(tableUi.editing, node.id, rowId, colId);
  // A cell pointed out by search glows for a moment; the key's parity restarts the animation.
  const glow = (rowId: string, colId: string) =>
    isCell(tableUi.flash, node.id, rowId, colId) ? (tableUi.flash!.key % 2 ? "glow-a" : "glow-b") : null;

  // A click that ends a drag of the table isn't a click on a cell.
  let down = { x: 0, y: 0 };
  const press = (e: PointerEvent, rowId: string, colId: string) => {
    if (e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY };
    selectCell(ref(rowId, colId));
  };
  const moved = (e: MouseEvent) => Math.hypot(e.clientX - down.x, e.clientY - down.y) > 3;

  function clickStatus(e: MouseEvent, row: TableRow, col: TableColumn) {
    if (moved(e)) return;
    cycleCell(ref(row.id, col.id), e.shiftKey ? -1 : 1);
  }

  function edit(e: MouseEvent, rowId: string, colId: string) {
    e.stopPropagation();
    editCell(ref(rowId, colId));
  }

  /** Right-click: the state picker on a status cell, the table's menu elsewhere. */
  function menu(e: MouseEvent, rowId: string, colId: string, status: boolean) {
    e.preventDefault();
    e.stopPropagation();
    selectCell(ref(rowId, colId));
    if (status) {
      tableUi.picker = { ...ref(rowId, colId), x: e.clientX, y: e.clientY };
      play("tap", { volume: 0.4, pitch: 1.15 });
      return;
    }
    const v = document.querySelector(".viewport")?.getBoundingClientRect();
    ui.menu = { x: e.clientX, y: e.clientY, world: camera.toWorld(e.clientX - (v?.left ?? 0), e.clientY - (v?.top ?? 0)), target: "table" };
  }

  // ---------------------------------------------------------------- typing

  function focus(el: HTMLInputElement) {
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }

  let cancelled = false;
  function onKeydown(e: KeyboardEvent) {
    const r = tableUi.editing;
    if (!r) return;
    const input = e.target as HTMLInputElement;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelled = true;
      cancelCell();
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitCell(input.value);
      moveCell(r, 1, 0);
    } else if (e.key === "Tab" || e.code === "Tab") {
      e.preventDefault();
      commitCell(input.value);
      nextCell(r, e.shiftKey ? -1 : 1);
    }
  }
  function onBlur(e: FocusEvent) {
    if (cancelled) return void (cancelled = false);
    if (tableUi.editing?.nodeId === node.id) commitCell((e.target as HTMLInputElement).value);
  }

  // ---------------------------------------------------------------- adding

  function addRow(e: MouseEvent) {
    e.stopPropagation();
    change(node.id, "Add row", (t) => insertRow(t, t.rows.length));
    play("appear", { volume: 0.5 });
  }
  function addColumn(e: MouseEvent) {
    e.stopPropagation();
    change(node.id, "Add column", (t) => insertColumn(t, t.columns.length, t.columns.at(-1)?.type ?? "text"));
    play("appear", { volume: 0.5, pitch: 1.1 });
  }

  // ---------------------------------------------------------------- column widths

  /** Drags a column's right border (or the header column's): live, recorded as one step at the end. */
  function startResize(e: PointerEvent, colId: string) {
    e.preventDefault();
    e.stopPropagation();
    const before = $state.snapshot(node.data);
    const start = colId === HEAD ? d.headerWidth : (d.columns.find((c) => c.id === colId)?.width ?? 8);
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => {
      const w = Math.round(Math.min(MAX_COL, Math.max(MIN_COL, start + (ev.clientX - x0) / (d.fontSize * camera.zoom))) * 4) / 4;
      const cur = tableData(node.data);
      node.data = colId === HEAD ? { ...cur, headerWidth: w } : { ...cur, columns: cur.columns.map((c) => (c.id === colId ? { ...c, width: w } : c)) };
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const after = $state.snapshot(node.data);
      if (JSON.stringify(after) !== JSON.stringify(before)) {
        history.record("Resize column", [{ type: "updateNodes", changes: [{ id: node.id, props: { data: after } }] }], [{ type: "updateNodes", changes: [{ id: node.id, props: { data: before } }] }]);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const stop = (e: Event) => e.stopPropagation();
</script>

{#snippet bar(p: { done: number; total: number } | null)}
  {#if progress && p && p.total}
    <span class="progress" {@attach tip(`${p.done}/${p.total} done`)}><span class="fill" style:width="{(p.done / p.total) * 100}%"></span></span>
  {/if}
{/snippet}

{#snippet input(rowId: string, colId: string)}
  <input class="cell-input" data-editor value={tableUi.editing?.initial ?? ""} spellcheck="false" onkeydown={onKeydown} onblur={onBlur} onpointerdown={stop} {@attach focus} />
{/snippet}

<div class="table" class:selected bind:this={box} data-table={node.id} style:font-size="{d.fontSize}px">
  <div class="grid" style:grid-template-columns={columns}>
    {#if d.headerRow}
      {#if d.headerCol}<div class="cell corner"></div>{/if}
      {#each d.columns as col, i (col.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="cell head"
          class:at={at(HEAD, col.id)}
          data-cell="{HEAD}:{col.id}"
          style:animation-name={glow(HEAD, col.id)}
          onpointerdown={(e) => press(e, HEAD, col.id)}
          ondblclick={(e) => edit(e, HEAD, col.id)}
          oncontextmenu={(e) => menu(e, HEAD, col.id, false)}
        >
          {#if typing(HEAD, col.id)}{@render input(HEAD, col.id)}{:else}<span class:placeholder={!col.name}>{col.name || `Column ${i + 1}`}</span>{/if}
          {@render bar(colProgress(col))}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span class="resize" {@attach tip("Drag to resize")} onpointerdown={(e) => startResize(e, col.id)} ondblclick={stop}></span>
        </div>
      {/each}
    {/if}
    {#each d.rows as row, ri (row.id)}
      {#if d.headerCol}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="cell head side"
          class:at={at(row.id, HEAD)}
          data-cell="{row.id}:{HEAD}"
          style:animation-name={glow(row.id, HEAD)}
          onpointerdown={(e) => press(e, row.id, HEAD)}
          ondblclick={(e) => edit(e, row.id, HEAD)}
          oncontextmenu={(e) => menu(e, row.id, HEAD, false)}
        >
          {#if typing(row.id, HEAD)}{@render input(row.id, HEAD)}{:else}<span class:placeholder={!row.name}>{row.name || `Row ${ri + 1}`}</span>{/if}
          {@render bar(rowProgress(row))}
          {#if ri === 0 && !d.headerRow}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="resize" {@attach tip("Drag to resize")} onpointerdown={(e) => startResize(e, HEAD)} ondblclick={stop}></span>
          {/if}
        </div>
      {/if}
      {#each d.columns as col (col.id)}
        {@const value = d.cells[cellKey(row.id, col.id)]}
        {#if col.type === "status"}
          {@const s = stateOf(col, value)}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div
            class="cell status"
            class:at={at(row.id, col.id)}
            class:color-only={col.colorOnly}
            data-cell="{row.id}:{col.id}"
          style:animation-name={glow(row.id, col.id)}
            data-status-cell
            {@attach tip(col.colorOnly && s.label)}
            style:--sc={STATE_COLORS[s.color]?.color ?? STATE_COLORS.gray.color}
            onpointerdown={(e) => press(e, row.id, col.id)}
            onclick={(e) => clickStatus(e, row, col)}
            ondblclick={stop}
            oncontextmenu={(e) => menu(e, row.id, col.id, true)}
          >
            {#if !col.colorOnly}<span class="state">{#if s.symbol}<b>{s.symbol}</b>{/if}{s.label}</span>{/if}
          </div>
        {:else if col.type === "checkbox"}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div
            class="cell checkbox"
            class:at={at(row.id, col.id)}
            data-cell="{row.id}:{col.id}"
          style:animation-name={glow(row.id, col.id)}
            onpointerdown={(e) => press(e, row.id, col.id)}
            onclick={(e) => clickStatus(e, row, col)}
            ondblclick={stop}
            oncontextmenu={(e) => menu(e, row.id, col.id, false)}
          >
            <span class="box" class:on={value === CHECKED}>{#if value === CHECKED}<Check strokeWidth={3} />{/if}</span>
          </div>
        {:else}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="cell"
            class:number={col.type === "number"}
            class:nan={col.type === "number" && !!value && numberOf(value) === null}
            class:at={at(row.id, col.id)}
            data-cell="{row.id}:{col.id}"
          style:animation-name={glow(row.id, col.id)}
            onpointerdown={(e) => press(e, row.id, col.id)}
            ondblclick={(e) => edit(e, row.id, col.id)}
            oncontextmenu={(e) => menu(e, row.id, col.id, false)}
          >
            {#if typing(row.id, col.id)}{@render input(row.id, col.id)}{:else}{value ?? ""}{/if}
          </div>
        {/if}
      {/each}
    {/each}
    {#if totals}
      {#if d.headerCol}<div class="cell head side total-label">Total</div>{/if}
      {#each d.columns as col (col.id)}
        <div class="cell total" class:number={col.type === "number"}>{col.type === "number" && col.total ? fmt(totalOf(d, col)) : ""}</div>
      {/each}
    {/if}
  </div>
  {#if selected}
    <button class="add add-col" {@attach tip("Add a column")} aria-label="Add a column" onpointerdown={stop} ondblclick={stop} onclick={addColumn}><Plus /></button>
    <button class="add add-row" {@attach tip("Add a row")} aria-label="Add a row" onpointerdown={stop} ondblclick={stop} onclick={addRow}><Plus /></button>
  {/if}
</div>

<style>
  .table {
    position: relative;
    width: max-content;
    padding: 0.5em;
    box-sizing: border-box;
    border-radius: calc(0.6em * var(--round));
    background: var(--panel-solid);
    color: var(--text);
    line-height: 1.35;
    box-shadow: 0 calc(3px * var(--inv-zoom)) calc(14px * var(--inv-zoom)) var(--node-shadow);
  }
  /* Cells draw their right and bottom borders; the grid draws the top and left ones. */
  .grid {
    display: grid;
    border-radius: calc(0.35em * var(--round));
    overflow: hidden;
    border-top: 1px solid var(--panel-border);
    border-left: 1px solid var(--panel-border);
  }
  .cell {
    position: relative;
    min-height: 1.35em;
    padding: 0.35em 0.55em;
    border-right: 1px solid var(--panel-border);
    border-bottom: 1px solid var(--panel-border);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    cursor: cell;
  }
  .head {
    font-weight: 650;
    background: var(--control-bg);
    cursor: default;
  }
  .side {
    font-weight: 600;
  }
  .corner {
    background: var(--control-bg);
    cursor: default;
  }
  .placeholder {
    color: var(--text-muted);
    font-weight: 500;
  }
  /* The selected cell: an inset ring (paint only). */
  .cell.at {
    box-shadow: inset 0 0 0 0.12em var(--accent);
  }
  .status {
    background: color-mix(in srgb, var(--sc) 18%, transparent);
    cursor: pointer;
    transition: background 120ms;
  }
  .status:hover {
    background: color-mix(in srgb, var(--sc) 28%, transparent);
  }
  .status.color-only {
    background: color-mix(in srgb, var(--sc) 65%, transparent);
  }
  .state {
    display: flex;
    gap: 0.35em;
    align-items: baseline;
    font-size: 0.9em;
    color: color-mix(in srgb, var(--sc) 70%, var(--text));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .state b {
    font-weight: 700;
  }
  /* Progress in a heading: a thin bar along its bottom (paint only). */
  .progress {
    position: absolute;
    left: 0.55em;
    right: 0.55em;
    bottom: 0.18em;
    height: 0.16em;
    border-radius: 0.08em;
    background: color-mix(in srgb, var(--text-muted) 22%, transparent);
    overflow: hidden;
  }
  .progress .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .checkbox {
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .box {
    display: grid;
    place-items: center;
    width: 1em;
    height: 1em;
    border-radius: calc(0.25em * var(--round));
    border: 0.1em solid color-mix(in srgb, var(--text-muted) 70%, transparent);
    color: var(--on-accent);
    transition:
      background 120ms,
      border-color 120ms;
  }
  .checkbox:hover .box {
    border-color: var(--accent);
  }
  .box.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .box :global(svg) {
    width: 0.75em;
    height: 0.75em;
  }
  .number {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .number .cell-input {
    text-align: right;
  }
  /* Text in a number column: kept, but it doesn't add up. */
  .nan {
    color: var(--text-muted);
    font-style: italic;
  }
  .total {
    font-weight: 650;
    border-top: 1px solid var(--panel-border);
    background: var(--control-bg);
  }
  .total-label {
    color: var(--text-muted);
  }
  /* Pointed out by search: the background glows and fades (paint only). */
  .cell {
    animation-duration: 1.6s;
    animation-timing-function: ease-out;
  }
  @keyframes glow-a {
    0%, 30% { background: color-mix(in srgb, var(--accent) 30%, transparent); }
  }
  @keyframes glow-b {
    0%, 30% { background: color-mix(in srgb, var(--accent) 30%, transparent); }
  }
  .cell-input {
    all: unset;
    width: 100%;
    font: inherit;
    color: inherit;
    caret-color: var(--accent);
    user-select: text;
    -webkit-user-select: text;
  }
  /* Column borders: a wide strip to drag; it shows the accent while hovered. */
  .resize {
    position: absolute;
    top: 0;
    right: -0.25em;
    width: 0.5em;
    height: 100%;
    cursor: col-resize;
    z-index: 1;
  }
  .resize:hover {
    background: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .add {
    /* Buttons don't inherit font-size; everything here is in em. */
    font: inherit;
    position: absolute;
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    border-radius: calc(0.35em * var(--round));
    background: var(--control-bg);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background 120ms,
      color 120ms;
  }
  .add:hover {
    background: var(--accent-wash);
    color: var(--accent);
  }
  .add :global(svg) {
    width: 0.85em;
    height: 0.85em;
  }
  .add-col {
    top: 0.5em;
    right: -1.6em;
    width: 1.2em;
    bottom: 0.5em;
  }
  .add-row {
    left: 0.5em;
    right: 0.5em;
    bottom: -1.6em;
    height: 1.2em;
  }
</style>
