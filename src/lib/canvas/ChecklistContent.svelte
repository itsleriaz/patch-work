<script lang="ts">
  import { fitSize } from "./flow";
  import { tip } from "../ui/tips.svelte";
  import { CalendarPlus, Check, ChevronDown, ChevronRight, GripVertical, Minus, Plus } from "@lucide/svelte";
  import { tick, untrack } from "svelte";
  import { commitEdit } from "../actions.svelte";
  import { history } from "../app.svelte";
  import { startTaskDrag } from "../checklist/drag.svelte";
  import {
    checklistData,
    daysUntil,
    takeDueWord,
    dueLabel,
    findTask,
    flatten,
    indentTask,
    insertTask,
    isDone,
    locate,
    newTask,
    outdentTask,
    progress,
    removeTask,
    toggleTask,
    visibleRows,
    type ChecklistData,
    type TaskItem,
  } from "../checklist/model";
  import { checklistUi, INDENT_EM, parentsOf } from "../checklist/state.svelte";
  import type { CanvasNode } from "../doc/types";
  import { play } from "../juice/sound";
  import { isMac } from "../platform";
  import { settings } from "../settings.svelte";

  let { node, editing }: { node: CanvasNode; editing: boolean } = $props();

  const data = $derived(checklistData(node.data));
  // Folded children never show; completed tasks hide when the list says so, except while editing.
  const hiding = $derived(!editing && !!data.hideDone);
  const rows = $derived(visibleRows(data.items, hiding));
  const total = $derived(progress(data.items));
  const hiddenDone = $derived(hiding ? total.done : 0);

  // A task pointed out from the Tasks tab: its row, or its nearest shown parent when it's folded
  // away or hidden. The key's parity picks one of two identical animations, so a repeat restarts it.
  const flash = $derived.by(() => {
    const f = checklistUi.flash;
    if (!f || f.nodeId !== node.id) return null;
    const shown = new Set(rows.map((r) => r.item.id));
    const id = [f.itemId, ...parentsOf(data.items, f.itemId).reverse()].find((i) => shown.has(i));
    return id ? { id, name: f.key % 2 ? "flash-a" : "flash-b" } : null;
  });

  // Due chips: overdue, today, tomorrow. "today" ticks over at midnight on the next render.
  function dueState(t: TaskItem, done: boolean) {
    if (!t.due) return null;
    const days = daysUntil(t.due);
    return {
      label: dueLabel(t.due),
      overdue: !done && days !== null && days < 0,
      soon: !done && (days === 0 || days === 1),
    };
  }

  /** Opens the due-date picker under the clicked chip or button. */
  function pickDue(e: MouseEvent, itemId: string) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    checklistUi.datePicker = { nodeId: node.id, itemId, x: r.left, y: r.bottom + 6 };
    play("tap", { volume: 0.4, pitch: 1.15 });
  }

  function toggleFold(e: MouseEvent, id: string) {
    e.stopPropagation();
    const folding = !findTask(data.items, id)?.collapsed;
    change(folding ? "Collapse task" : "Expand task", (d) => {
      const t = findTask(d.items, id);
      if (t) t.collapsed = folding;
    });
    play(folding ? "toggleOff" : "toggleOn", { volume: 0.5 });
  }

  function showDone(e: MouseEvent) {
    e.stopPropagation();
    change("Show completed", (d) => (d.hideDone = false));
    play("toggleOn", { volume: 0.5 });
  }
  const allDone = $derived(total.total > 0 && total.done === total.total);

  // The task being dragged and everything under it, shown faded while it travels.
  const dragged = $derived.by(() => {
    const d = checklistUi.drag;
    if (!d || d.nodeId !== node.id) return new Set<string>();
    const t = findTask(data.items, d.itemId);
    return new Set(t ? [t.id, ...flatten(t.children).map((r) => r.item.id)] : []);
  });
  const dropLine = $derived.by(() => {
    const t = checklistUi.drag?.target;
    return t?.kind === "list" && t.nodeId === node.id ? t : null;
  });

  let box: HTMLDivElement;

  // Height follows the content. Layout size is unaffected by the camera's scale.
  $effect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize[0]?.blockSize ?? box.offsetHeight;
      if (h > 0 && Math.abs(h - node.h) > 0.5) fitSize(node, node.w, h);
    });
    observer.observe(box);
    return () => observer.disconnect();
  });

  // Finishing the last task celebrates (not on load, and not twice in a row).
  let wasAllDone: boolean | null = null;
  let confetti = $state(0);
  $effect(() => {
    const done = allDone;
    if (wasAllDone === false && done) {
      play("celebrate", { volume: 0.8 });
      if (!settings.calm) confetti++;
    }
    wasAllDone = done;
  });
  const pieces = Array.from({ length: 18 }, (_, i) => ({
    angle: (i / 18) * 360 + Math.random() * 20,
    dist: 2.2 + Math.random() * 2.2,
    hue: Math.round(Math.random() * 360),
    delay: Math.random() * 80,
  }));

  /**
   * Applies a change. While editing it's live (the whole edit is one undo step, recorded when it
   * ends); otherwise it's its own undo step.
   */
  function change(label: string, fn: (d: ChecklistData) => void) {
    const d = structuredClone(checklistData($state.snapshot(node.data)));
    fn(d);
    if (editing) node.data = d;
    else history.run(label, [{ type: "updateNodes", changes: [{ id: node.id, props: { data: d } }] }]);
  }

  function toggle(id: string) {
    const result: { done: boolean | null } = { done: null };
    change("Check task", (d) => (result.done = toggleTask(d.items, id)));
    if (result.done !== null) play(result.done ? "toggleOn" : "toggleOff", { volume: 0.55, pitch: result.done ? 1.1 : 0.95 });
  }

  // ---------------------------------------------------------------- editing

  function focusTask(itemId: string | null, caret: number | "end" = "end") {
    void tick().then(() => {
      const el = itemId
        ? box?.querySelector<HTMLInputElement>(`input[data-task-input="${itemId}"]`)
        : box?.querySelector<HTMLInputElement>("input.title");
      if (!el) return;
      el.focus({ preventScroll: true });
      const at = caret === "end" ? el.value.length : Math.min(caret, el.value.length);
      el.setSelectionRange(at, at);
    });
  }

  // Entering edit mode focuses the requested task (a double-clicked row), else the first empty
  // one, else the last.
  $effect(() => {
    if (!editing) return;
    // Only entering edit mode matters here, not every change while editing.
    untrack(() => {
      const request = checklistUi.focus;
      if (request?.nodeId === node.id) {
        checklistUi.focus = null;
        focusTask(request.itemId, request.caret ?? "end");
        return;
      }
      const first = rows.find((r) => !r.item.text) ?? rows.at(-1);
      focusTask(first ? first.item.id : null);
    });
  });

  function setText(id: string, text: string) {
    // "@fri " (a date word and a space) becomes the task's due date.
    const taken = takeDueWord(text);
    change("", (d) => {
      const t = findTask(d.items, id);
      if (!t) return;
      t.text = taken ? taken.text : text;
      if (taken) t.due = taken.due;
    });
    if (taken) play("tap", { volume: 0.5, pitch: 1.25 });
    else play("type", { volume: 0.5, throttle: 25, jitter: 0.08 });
  }

  /** A date word left at the end of a task ("… @fri") when leaving it: its due date. */
  function takeTrailingDue(input: HTMLInputElement, id: string) {
    const taken = takeDueWord(input.value, true);
    if (!taken) return;
    input.value = taken.text;
    change("", (d) => {
      const t = findTask(d.items, id);
      if (!t) return;
      t.text = taken.text;
      t.due = taken.due;
    });
    play("tap", { volume: 0.5, pitch: 1.25 });
  }

  function addTaskAtEnd() {
    const task = newTask();
    change("Add task", (d) => d.items.push(task));
    focusTask(task.id);
  }

  const mod = (e: KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);

  function onTaskKeydown(e: KeyboardEvent, id: string) {
    const input = e.target as HTMLInputElement;
    if (e.key === "Enter" || e.key === "Escape" || e.key === "Tab" || e.code === "Tab") takeTrailingDue(input, id);
    const caret = Math.min(input.selectionStart ?? input.value.length, input.value.length);
    const index = rows.findIndex((r) => r.item.id === id);

    if (e.key === "Escape") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Enter" && mod(e)) {
      e.preventDefault();
      toggle(id);
    } else if (e.key === "Enter") {
      // Splits at the caret: the rest of the text moves to a new task below (or the first child).
      e.preventDefault();
      const task = newTask(input.value.slice(caret));
      change("Add task", (d) => {
        const at = locate(d.items, id);
        if (!at) return;
        const current = at.list[at.index];
        current.text = input.value.slice(0, caret);
        // Into an open parent as its first child; after a folded one as a sibling.
        if (current.children.length && !current.collapsed) current.children.unshift(task);
        else at.list.splice(at.index + 1, 0, task);
      });
      focusTask(task.id, 0);
    } else if (e.key === "Tab" || e.code === "Tab") {
      // By the physical key too: WebKitGTK reports Shift+Tab as key "Unidentified" (code "Tab"),
      // so Shift+Tab moved focus to the checkbox instead of un-nesting.
      e.preventDefault();
      change("Indent", (d) => {
        if (e.shiftKey) return void outdentTask(d.items, id);
        // Nesting under a folded task unfolds it, so the task stays in view.
        const at = locate(d.items, id);
        const above = at && at.index > 0 ? at.list[at.index - 1] : null;
        if (indentTask(d.items, id) && above) above.collapsed = false;
      });
      focusTask(id, caret);
    } else if (e.key === "Backspace" && input.value === "" && rows[index]?.item.children.length === 0) {
      // An empty task goes away; the caret moves to the end of the one above.
      e.preventDefault();
      const above = rows[index - 1]?.item.id ?? null;
      change("Remove task", (d) => removeTask(d.items, id));
      focusTask(above);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusTask(rows[index - 1]?.item.id ?? null, caret);
    } else if (e.key === "ArrowDown" && index < rows.length - 1) {
      e.preventDefault();
      focusTask(rows[index + 1].item.id, caret);
    }
  }

  function onTitleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      if (rows.length) focusTask(rows[0].item.id, 0);
      else addTaskAtEnd();
    }
  }

  // Leaving the card for somewhere else ends the edit. Decided once focus settles: indenting or
  // reordering moves a row in the DOM, which blurs its input for a moment before it's refocused.
  function onFocusOut(e: FocusEvent) {
    const input = e.target as HTMLInputElement;
    const id = input.dataset?.taskInput;
    if (id) takeTrailingDue(input, id);
    setTimeout(() => {
      if (editing && box && !box.contains(document.activeElement)) commitEdit();
    }, 0);
  }

  const stop = (e: Event) => e.stopPropagation();
</script>

<div
  class="checklist"
  class:editing
  class:all-done={allDone}
  bind:this={box}
  data-checklist={node.id}
  data-editor={editing ? "" : undefined}
  style:font-size="{data.fontSize}px"
  style:--indent="{INDENT_EM}em"
  onfocusout={onFocusOut}
>
  <div class="head">
    {#if editing}
      <input
        class="title"
        value={data.title}
        placeholder="Checklist"
        spellcheck="false"
        oninput={(e) => change("", (d) => (d.title = (e.target as HTMLInputElement).value))}
        onkeydown={onTitleKeydown}
      />
    {:else}
      <div class="title" class:placeholder={!data.title}>{data.title || "Checklist"}</div>
    {/if}
    {#if total.total}<span class="count">{total.done}/{total.total}</span>{/if}
  </div>
  {#if total.total}
    <div class="bar"><div class="fill" style:width="{(total.done / total.total) * 100}%"></div></div>
  {/if}

  <div class="rows" data-rows>
    {#each rows as row (row.item.id)}
      {@const done = isDone(row.item)}
      {@const sub = row.item.children.length ? progress(row.item.children) : null}
      {@const due = dueState(row.item, done)}
      <div
        class="row"
        class:done
        class:dragged={dragged.has(row.item.id)}
        data-task-row
        data-item-id={row.item.id}
        style:animation-name={flash?.id === row.item.id ? flash.name : null}
        style:padding-left="calc({row.depth} * var(--indent))"
      >
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="grip" {@attach tip("Drag to move")} onpointerdown={(e) => startTaskDrag(e, node.id, row.item.id)} ondblclick={stop}>
          <GripVertical />
        </span>
        <button
          class="check"
          class:done
          class:partial={!done && !!sub && sub.done > 0}
          aria-label={done ? "Uncheck" : "Check"}
          onpointerdown={stop}
          ondblclick={stop}
          onclick={() => toggle(row.item.id)}
        >
          {#if done}<Check strokeWidth={3} />{:else if sub && sub.done > 0}<Minus strokeWidth={3} />{/if}
        </button>
        {#if editing}
          <input
            class="text"
            data-task-input={row.item.id}
            value={row.item.text}
            placeholder="Task"
            spellcheck="false"
            oninput={(e) => setText(row.item.id, (e.target as HTMLInputElement).value)}
            onkeydown={(e) => onTaskKeydown(e, row.item.id)}
          />
        {:else}
          <span class="text" class:placeholder={!row.item.text}>{row.item.text || "Task"}</span>
        {/if}
        {#if due}
          <button class="due" class:overdue={due.overdue} class:soon={due.soon} class:done {@attach tip("Due date")} onpointerdown={stop} ondblclick={stop} onclick={(e) => pickDue(e, row.item.id)}>
            {due.label}
          </button>
        {:else}
          <button class="due-add" {@attach tip("Set a due date")} aria-label="Set a due date" onpointerdown={stop} ondblclick={stop} onclick={(e) => pickDue(e, row.item.id)}>
            <CalendarPlus />
          </button>
        {/if}
        {#if sub}
          <span class="sub">{sub.done}/{sub.total}</span>
          <button
            class="fold"
            {@attach tip(row.item.collapsed ? "Expand" : "Collapse")}
            aria-label={row.item.collapsed ? "Expand" : "Collapse"}
            onpointerdown={stop}
            ondblclick={stop}
            onclick={(e) => toggleFold(e, row.item.id)}
          >
            {#if row.item.collapsed}<ChevronRight />{:else}<ChevronDown />{/if}
          </button>
        {/if}
      </div>
    {/each}
    {#if dropLine}
      <div class="drop-line" style:top="{dropLine.lineTop}px" style:left="calc({dropLine.depth} * var(--indent) + 1.2em)"></div>
    {/if}
  </div>

  {#if editing}
    <button class="add" onpointerdown={stop} onclick={addTaskAtEnd}><Plus /> Add task</button>
  {:else if hiddenDone}
    <button class="hidden-done" onpointerdown={stop} ondblclick={stop} onclick={showDone} {@attach tip("Show completed tasks")}>
      {hiddenDone} done hidden
    </button>
  {:else if !rows.length}
    <div class="empty">No tasks yet</div>
  {/if}

  {#key confetti}
    {#if confetti}
      <div class="confetti" aria-hidden="true">
        {#each pieces as p, i (i)}
          <span style:--a="{p.angle}deg" style:--d="{p.dist}em" style:--h={p.hue} style:animation-delay="{p.delay}ms"></span>
        {/each}
      </div>
    {/if}
  {/key}
</div>

<style>
  .checklist {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    padding: 0.7em 0.9em 0.75em 0.6em;
    border-radius: calc(0.6em * var(--round));
    background: var(--panel-solid);
    color: var(--text);
    line-height: 1.35;
    box-shadow: 0 calc(3px * var(--inv-zoom)) calc(14px * var(--inv-zoom)) var(--node-shadow);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 0.6em;
    padding-left: 0.35em;
    margin-bottom: 0.35em;
  }
  .title {
    flex: 1;
    min-width: 0;
    font-weight: 650;
    font-size: 1.05em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count,
  .sub {
    flex: none;
    font-size: 0.75em;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .all-done .count {
    color: var(--accent);
    font-weight: 600;
  }
  .bar {
    height: 0.22em;
    margin: 0 0 0.5em 0.35em;
    border-radius: calc(0.11em * var(--round));
    background: var(--control-bg);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 300ms cubic-bezier(0.34, 1.3, 0.64, 1);
  }
  .rows {
    position: relative;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.3em;
    min-height: 1.8em;
    transition: opacity 200ms ease;
  }
  /* Pointed out from the Tasks tab: the background glows and fades (paint only). */
  .row {
    animation-duration: 1.6s;
    animation-timing-function: ease-out;
    border-radius: calc(0.35em * var(--round));
  }
  @keyframes flash-a {
    0%, 30% { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  }
  @keyframes flash-b {
    0%, 30% { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  }
  .row.dragged {
    opacity: 0.3;
  }
  /* Hover reveals fade in by color, not opacity: an opacity transition gets its own compositing
     layer, and the whole camera layer is redrawn blurry around it for a moment (HANDOFF §8). */
  .grip {
    flex: none;
    width: 0.9em;
    display: grid;
    place-items: center;
    color: transparent;
    cursor: grab;
    transition: color 120ms;
  }
  .row:hover .grip,
  .editing .grip {
    color: color-mix(in srgb, var(--text-muted) 70%, transparent);
  }
  .grip :global(svg) {
    width: 0.9em;
    height: 0.9em;
  }
  .check {
    /* Buttons don't inherit font-size; everything here is in em. */
    font: inherit;
    flex: none;
    width: 1.05em;
    height: 1.05em;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0.11em solid color-mix(in srgb, var(--text-muted) 70%, transparent);
    border-radius: calc(0.28em * var(--round));
    background: transparent;
    color: var(--on-accent);
    cursor: pointer;
    /* No animated scale: it would get a compositing layer (blurry flash, HANDOFF §8). */
    transition:
      background 140ms,
      border-color 140ms;
  }
  .check:hover {
    border-color: var(--accent);
  }
  .check:active {
    scale: 0.85;
  }
  .check.done,
  .check.partial {
    background: var(--accent);
    border-color: var(--accent);
  }
  .check.done {
    animation: tick-in 260ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .check :global(svg) {
    width: 0.8em;
    height: 0.8em;
  }
  .text {
    flex: 1;
    min-width: 0;
    font: inherit;
    color: inherit;
    overflow-wrap: anywhere;
    transition: color 250ms ease;
  }
  input.text,
  input.title {
    border: none;
    outline: none;
    background: transparent;
    padding: 0;
    margin: 0;
    color: inherit;
    font: inherit;
    caret-color: var(--accent);
    user-select: text;
    -webkit-user-select: text;
  }
  input.title {
    font-weight: 650;
    font-size: 1.05em;
  }
  .placeholder,
  input::placeholder {
    color: var(--text-muted);
    opacity: 0.6;
  }
  /* Done: faded and struck through. */
  .row.done .text {
    color: color-mix(in srgb, currentColor 45%, transparent);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, currentColor 60%, transparent);
  }
  /* Due date: a chip after the task; red when overdue, accent for today and tomorrow. */
  .due,
  .due-add,
  .fold,
  .hidden-done {
    /* Buttons don't inherit font-size; everything here is in em. */
    font: inherit;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    color: var(--text-muted);
  }
  .due {
    flex: none;
    font-size: 0.72em;
    padding: 0.1em 0.5em;
    border-radius: calc(0.6em * var(--round));
    background: var(--control-bg);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .due:hover {
    color: var(--text);
  }
  .due.soon {
    background: var(--accent-wash);
    color: var(--accent);
  }
  .due.overdue {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
    color: var(--danger);
    font-weight: 600;
  }
  .due.done {
    opacity: 0.5;
  }
  .due-add,
  .fold {
    flex: none;
    display: grid;
    place-items: center;
    width: 1.1em;
    height: 1.1em;
    border-radius: calc(0.3em * var(--round));
  }
  .due-add {
    color: transparent;
    transition: color 120ms;
  }
  .row:hover .due-add {
    color: color-mix(in srgb, var(--text-muted) 70%, transparent);
  }
  .due-add:hover,
  .fold:hover {
    color: var(--text);
    background: var(--panel-hover);
  }
  .due-add :global(svg),
  .fold :global(svg) {
    width: 0.8em;
    height: 0.8em;
  }
  .hidden-done {
    margin: 0.2em 0 0 1.55em;
    font-size: 0.78em;
  }
  .hidden-done:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .drop-line {
    position: absolute;
    right: 0;
    height: 0.16em;
    margin-top: -0.08em;
    border-radius: calc(0.08em * var(--round));
    background: var(--accent);
    pointer-events: none;
  }
  .drop-line::before {
    content: "";
    position: absolute;
    left: -0.25em;
    top: -0.17em;
    width: 0.5em;
    height: 0.5em;
    border-radius: 50%;
    background: var(--accent);
  }
  .add {
    font: inherit;
    display: flex;
    align-items: center;
    gap: 0.35em;
    margin: 0.25em 0 0 1.2em;
    padding: 0.15em 0.4em;
    border: none;
    border-radius: calc(0.35em * var(--round));
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  .add:hover {
    background: var(--panel-hover);
    color: var(--text);
  }
  .add :global(svg) {
    width: 0.9em;
    height: 0.9em;
  }
  .empty {
    padding-left: 1.55em;
    color: var(--text-muted);
    font-size: 0.85em;
  }
  /* The whole list done: a burst of confetti from the top. */
  .confetti {
    position: absolute;
    left: 50%;
    top: 1em;
    width: 0;
    height: 0;
    pointer-events: none;
  }
  .confetti span {
    position: absolute;
    width: 0.4em;
    height: 0.25em;
    border-radius: calc(0.06em * var(--round));
    background: hsl(var(--h) 85% 60%);
    opacity: 0;
    animation: burst 900ms cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
  }
  @keyframes burst {
    0% {
      opacity: 1;
      transform: rotate(var(--a)) translateX(0) rotate(0deg);
    }
    100% {
      opacity: 0;
      transform: rotate(var(--a)) translateX(var(--d)) rotate(260deg) translateY(1.2em);
    }
  }
  /* Checked: a ring flashes out (paint only, no compositing layer). */
  @keyframes tick-in {
    from {
      box-shadow: 0 0 0 0.3em color-mix(in srgb, var(--accent) 45%, transparent);
    }
    to {
      box-shadow: 0 0 0 0.45em transparent;
    }
  }
  :global(:root[data-calm]) .check.done {
    animation: none;
  }
</style>
