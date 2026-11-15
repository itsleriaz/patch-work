<script lang="ts">
  import { tip } from "./tips.svelte";
  import { ArrowDown, ArrowUp, Check, Plus, X } from "@lucide/svelte";
  import { scale } from "svelte/transition";
  import { doc } from "../app.svelte";
  import { play } from "../juice/sound";
  import { isDoneState, STATE_COLORS, statesOf, tableData, type StateColor, type TableState } from "../table/model";
  import { change, openStatesEditor, setState, stateIdAt, tableUi } from "../table/table.svelte";

  /**
   * The table's two popovers, in screen space (readable at any zoom):
   * - the state picker (right-click a status cell): choose a state directly;
   * - the states editor for a status column: label, color and symbol per state, whether it counts
   *   as done (for progress), order, add, remove, and "Apply to all status columns". Each change
   *   is one undo step.
   */

  const picker = $derived(tableUi.picker);
  const editor = $derived(tableUi.statesEditor);

  const columnOf = (nodeId: string, colId: string) => {
    const n = doc.nodes[nodeId];
    return n?.kind === "table" ? tableData(n.data).columns.find((c) => c.id === colId) : undefined;
  };
  const pickerCol = $derived(picker ? columnOf(picker.nodeId, picker.colId) : undefined);
  const pickerCurrent = $derived(picker ? stateIdAt(picker) : null);
  const editorCol = $derived(editor ? columnOf(editor.nodeId, editor.colId) : undefined);
  const states = $derived(editorCol ? statesOf(editorCol) : []);

  const COLORS = Object.keys(STATE_COLORS) as StateColor[];

  /** Changes the edited column's states as one undo step. */
  function editStates(label: string, fn: (states: TableState[]) => TableState[] | void) {
    const e = editor;
    if (!e) return;
    change(e.nodeId, label, (d) => {
      const col = d.columns.find((c) => c.id === e.colId);
      if (!col) return;
      const list = statesOf(col).map((s) => ({ ...s }));
      col.states = fn(list) ?? list;
    });
  }

  const nextColor = (c: StateColor) => COLORS[(COLORS.indexOf(c) + 1) % COLORS.length];

  /** Flips whether a state counts as done; the first time, every state's current answer is written down. */
  function toggleDone(i: number) {
    const col = editorCol;
    if (!col) return;
    editStates("State counts as done", (list) => {
      for (const s of list) s.done = isDoneState(col, s);
      list[i].done = !list[i].done;
    });
  }
  const uid = () => crypto.randomUUID().slice(0, 8);

  function applyToAll() {
    const e = editor;
    if (!e || !editorCol) return;
    const source = statesOf(editorCol);
    change(e.nodeId, "Apply states to all status columns", (d) => {
      for (const c of d.columns) if (c.type === "status" && c.id !== e.colId) c.states = source.map((s) => ({ ...s }));
    });
    play("swipe", { volume: 0.5, pitch: 1.2 });
  }

  // Inside the window, below its anchor (or above when there's no room).
  const place = (x: number, y: number, w: number, h: number) => ({
    left: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
    top: y + h > window.innerHeight - 8 ? Math.max(8, y - h - 8) : y,
  });
  const pickerAt = $derived(picker ? place(picker.x, picker.y, 200, 40 + (pickerCol ? statesOf(pickerCol).length * 30 : 0)) : { left: 0, top: 0 });
  const editorAt = $derived(editor ? place(editor.x, editor.y, 300, 120 + states.length * 34) : { left: 0, top: 0 });

  let pickerEl = $state<HTMLDivElement>();
  let editorEl = $state<HTMLDivElement>();
</script>

<svelte:window
  onpointerdown={(e) => {
    const t = e.target as Node;
    if (picker && !pickerEl?.contains(t)) tableUi.picker = null;
    if (editor && !editorEl?.contains(t)) tableUi.statesEditor = null;
  }}
  onkeydowncapture={(e) => {
    if (e.key !== "Escape" || (!picker && !editor)) return;
    e.preventDefault();
    e.stopPropagation();
    tableUi.picker = null;
    tableUi.statesEditor = null;
  }}
/>

{#if picker && pickerCol}
  <div class="pop picker" bind:this={pickerEl} style:left="{pickerAt.left}px" style:top="{pickerAt.top}px" transition:scale={{ duration: 120, start: 0.95 }}>
    {#each statesOf(pickerCol) as s (s.id)}
      <button
        class="option"
        onclick={() => {
          setState(picker, s.id);
          tableUi.picker = null;
        }}
      >
        <span class="swatch" style:background={STATE_COLORS[s.color]?.color}></span>
        <span class="label">{#if s.symbol}<b>{s.symbol}</b> {/if}{s.label || "State"}</span>
        {#if s.id === pickerCurrent}<Check size={13} strokeWidth={2.4} />{/if}
      </button>
    {/each}
    <div class="sep"></div>
    <button
      class="option muted"
      onclick={() => {
        const p = picker;
        tableUi.picker = null;
        openStatesEditor(p.nodeId, p.colId);
      }}>Edit states…</button
    >
  </div>
{/if}

{#if editor && editorCol}
  <div class="pop editor" bind:this={editorEl} style:left="{editorAt.left}px" style:top="{editorAt.top}px" transition:scale={{ duration: 120, start: 0.95 }}>
    <header>
      <span>States of “{editorCol.name || "this column"}”</span>
      <button class="icon" aria-label="Close" onclick={() => (tableUi.statesEditor = null)}><X size={14} /></button>
    </header>
    {#each states as s, i (s.id)}
      <div class="state-row">
        <button
          class="swatch big"
          aria-label="State color"
          {@attach tip({ text: `Color: ${STATE_COLORS[s.color]?.label}`, detail: "Click for the next one" })}
          style:background={STATE_COLORS[s.color]?.color}
          onclick={() => editStates("State color", (list) => void (list[i].color = nextColor(list[i].color)))}
        ></button>
        <input
          class="symbol"
          value={s.symbol}
          maxlength="2"
          placeholder="·"
          {@attach tip("Symbol (optional)")}
          spellcheck="false"
          onchange={(e) => editStates("State symbol", (list) => void (list[i].symbol = (e.target as HTMLInputElement).value.trim()))}
        />
        <input
          class="name"
          value={s.label}
          placeholder="State"
          spellcheck="false"
          onchange={(e) => editStates("Rename state", (list) => void (list[i].label = (e.target as HTMLInputElement).value.trim()))}
          onkeydown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <button
          class="icon done"
          class:on={editorCol && isDoneState(editorCol, s)}
          {@attach tip({ text: editorCol && isDoneState(editorCol, s) ? "Counts as done" : "Doesn't count as done", detail: "Click to change" })}
          aria-label="Counts as done"
          onclick={() => toggleDone(i)}><Check size={13} strokeWidth={2.6} /></button
        >
        <button class="icon" aria-label="Move up" disabled={i === 0} onclick={() => editStates("Reorder states", (list) => void list.splice(i - 1, 0, list.splice(i, 1)[0]))}><ArrowUp size={13} /></button>
        <button class="icon" aria-label="Move down" disabled={i === states.length - 1} onclick={() => editStates("Reorder states", (list) => void list.splice(i + 1, 0, list.splice(i, 1)[0]))}><ArrowDown size={13} /></button>
        <button class="icon danger" aria-label="Remove" disabled={states.length <= 1} onclick={() => editStates("Remove state", (list) => list.filter((_, k) => k !== i))}><X size={13} /></button>
      </div>
    {/each}
    <div class="actions">
      <button class="text-button" onclick={() => editStates("Add state", (list) => void list.push({ id: uid(), label: "New state", color: COLORS[list.length % COLORS.length], symbol: "" }))}>
        <Plus size={13} /> Add state
      </button>
      <button class="text-button" onclick={applyToAll}>Apply to all status columns</button>
    </div>
  </div>
{/if}

<style>
  .pop {
    position: fixed;
    z-index: 120;
    box-sizing: border-box;
    padding: 6px;
    border-radius: calc(10px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 12px 36px var(--panel-shadow);
    color: var(--text);
    font-size: 12.5px;
    user-select: none;
    transform-origin: top left;
  }
  .picker {
    min-width: 180px;
  }
  .editor {
    width: 326px;
  }
  button {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border-radius: calc(6px * var(--round));
  }
  .option:hover {
    background: var(--panel-hover);
  }
  .option .label {
    flex: 1;
  }
  .muted {
    color: var(--text-muted);
  }
  .sep {
    height: 1px;
    margin: 4px 2px;
    background: var(--panel-border);
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex: none;
  }
  .swatch.big {
    width: 18px;
    height: 18px;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 18%, transparent);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 2px 6px 6px;
    font-weight: 600;
  }
  .state-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 4px;
  }
  input {
    all: unset;
    box-sizing: border-box;
    padding: 3px 6px;
    border-radius: calc(5px * var(--round));
    background: var(--control-bg);
    user-select: text;
    -webkit-user-select: text;
  }
  input:focus {
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  .symbol {
    width: 30px;
    text-align: center;
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: calc(5px * var(--round));
    color: var(--text-muted);
  }
  .icon:hover:not(:disabled) {
    background: var(--panel-hover);
    color: var(--text);
  }
  /* "Counts as done": faint when off, the accent when on. */
  .icon.done {
    color: color-mix(in srgb, var(--text-muted) 45%, transparent);
  }
  .icon.done.on {
    color: var(--accent);
    background: var(--accent-wash);
  }
  .icon.danger:hover:not(:disabled) {
    color: var(--danger);
  }
  .actions {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    padding: 4px 4px 0;
    border-top: 1px solid var(--panel-border);
  }
  .text-button {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    border-radius: calc(6px * var(--round));
    color: var(--text-muted);
  }
  .text-button:hover {
    background: var(--panel-hover);
    color: var(--text);
  }
</style>
