<script lang="ts">
  import { ChevronLeft, ChevronRight } from "@lucide/svelte";
  import { scale } from "svelte/transition";
  import { doc } from "../app.svelte";
  import { checklistData, dayKey, findTask, parseDay } from "../checklist/model";
  import { checklistUi, setDue } from "../checklist/state.svelte";
  import { play } from "../juice/sound";

  /**
   * The due-date picker for a checklist task, in screen space (readable at any zoom): quick
   * picks, a month grid (weeks start on Monday) and Clear. It never takes focus, so a task being
   * typed into keeps its caret. Esc or a click outside closes it.
   */

  const open = $derived(checklistUi.datePicker);
  const task = $derived.by(() => {
    const p = open;
    const n = p ? doc.nodes[p.nodeId] : undefined;
    return p && n ? findTask(checklistData(n.data).items, p.itemId) : null;
  });
  const current = $derived(task?.due ?? null);

  const today = new Date();
  const todayKey = dayKey(today);

  // The month shown: the due date's, else this one.
  let month = $state(new Date(today.getFullYear(), today.getMonth(), 1));
  $effect(() => {
    void open;
    const d = (current && parseDay(current)) || today;
    month = new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const title = $derived(month.toLocaleDateString(undefined, { month: "long", year: "numeric" }));
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }));

  /** Six weeks from the Monday on or before the 1st. */
  const days = $derived.by(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(first.getFullYear(), first.getMonth(), 1 - offset + i);
      return { key: dayKey(d), day: d.getDate(), inMonth: d.getMonth() === month.getMonth() };
    });
  });

  const plus = (n: number) => dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));
  const QUICK: [string, () => string][] = [
    ["Today", () => plus(0)],
    ["Tomorrow", () => plus(1)],
    ["Next week", () => plus(7)],
  ];

  function pick(key: string | null) {
    if (open) setDue(open.nodeId, open.itemId, key);
    checklistUi.datePicker = null;
  }

  function shift(months: number) {
    month = new Date(month.getFullYear(), month.getMonth() + months, 1);
    play("tap", { volume: 0.3, pitch: months > 0 ? 1.1 : 0.9 });
  }

  // Inside the window, below its anchor (or above when there's no room).
  const W = 236, H = 300;
  const left = $derived(open ? Math.max(8, Math.min(open.x, window.innerWidth - W - 8)) : 0);
  const top = $derived(open ? (open.y + H > window.innerHeight - 8 ? Math.max(8, open.y - H - 40) : open.y) : 0);

  let host = $state<HTMLDivElement>();
</script>

<svelte:window
  onpointerdown={(e) => open && !host?.contains(e.target as Node) && (checklistUi.datePicker = null)}
  onkeydowncapture={(e) => {
    if (open && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      checklistUi.datePicker = null;
    }
  }}
/>

{#if open && task}
  <!-- Pressing inside never takes focus away from a task being typed into. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="picker"
    bind:this={host}
    style:left="{left}px"
    style:top="{top}px"
    style:width="{W}px"
    onpointerdown={(e) => e.preventDefault()}
    onmousedown={(e) => e.preventDefault()}
    transition:scale={{ duration: 130, start: 0.94 }}
  >
    <div class="quick">
      {#each QUICK as [label, key] (label)}
        <button class:on={current === key()} onclick={() => pick(key())}>{label}</button>
      {/each}
    </div>
    <div class="month">
      <button class="nav" aria-label="Previous month" onclick={() => shift(-1)}><ChevronLeft size={15} /></button>
      <span>{title}</span>
      <button class="nav" aria-label="Next month" onclick={() => shift(1)}><ChevronRight size={15} /></button>
    </div>
    <div class="grid">
      {#each weekdays as w, i (i)}<span class="wd">{w}</span>{/each}
      {#each days as d (d.key)}
        <button class="day" class:out={!d.inMonth} class:today={d.key === todayKey} class:on={d.key === current} onclick={() => pick(d.key)}>
          {d.day}
        </button>
      {/each}
    </div>
    {#if current}
      <button class="clear" onclick={() => pick(null)}>Clear due date</button>
    {/if}
  </div>
{/if}

<style>
  .picker {
    position: fixed;
    z-index: 120;
    box-sizing: border-box;
    padding: 8px;
    border-radius: calc(12px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 12px 36px var(--panel-shadow);
    color: var(--text);
    font-size: 12.5px;
    user-select: none;
    transform-origin: top left;
  }
  button {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    text-align: center;
  }
  .quick {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
  }
  .quick button {
    flex: 1;
    padding: 4px 0;
    border-radius: calc(6px * var(--round));
    background: var(--control-bg);
  }
  .quick button:hover {
    background: var(--panel-hover);
  }
  .quick button.on {
    background: var(--accent);
    color: var(--on-accent);
  }
  .month {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
    font-weight: 600;
  }
  .nav {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: calc(6px * var(--round));
    color: var(--text-muted);
  }
  .nav:hover {
    background: var(--panel-hover);
    color: var(--text);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .wd {
    text-align: center;
    font-size: 10.5px;
    color: var(--text-muted);
    padding: 2px 0;
  }
  .day {
    height: 26px;
    line-height: 26px;
    border-radius: calc(6px * var(--round));
    font-variant-numeric: tabular-nums;
  }
  .day:hover {
    background: var(--panel-hover);
  }
  .day.out {
    color: var(--text-muted);
    opacity: 0.55;
  }
  .day.today {
    box-shadow: inset 0 0 0 1.5px var(--accent);
    color: var(--accent);
    font-weight: 600;
  }
  .day.on {
    background: var(--accent);
    color: var(--on-accent);
    box-shadow: none;
  }
  .clear {
    display: block;
    width: 100%;
    margin-top: 8px;
    padding: 5px 0;
    border-radius: calc(6px * var(--round));
    color: var(--text-muted);
  }
  .clear:hover {
    background: var(--panel-hover);
    color: var(--danger);
  }
</style>
