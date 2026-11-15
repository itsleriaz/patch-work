<script lang="ts">
  import { Check, ChevronLeft, ChevronRight } from "@lucide/svelte";
  import { ui } from "../app.svelte";
  import { dayKey, parseDay } from "../checklist/model";
  import { setDue, toggleTaskIn } from "../checklist/state.svelte";
  import { editTask, filteredTasks, showTask, type TaskRef } from "../checklist/tasks.svelte";
  import { play } from "../juice/sound";
  import { settings } from "../settings.svelte";
  import { tip } from "./tips.svelte";

  /**
   * The Tasks tab's calendar (agreed in the panels design): a month grid, weeks from Monday, each
   * day with a dot per task due (red: overdue, the accent: open, dim: done), today ringed. The
   * selected day's tasks are listed below it: check them, click to show one on the board,
   * double-click to edit it, or drag it onto another day to move its due date (one undo step).
   * The tab's filter and search apply.
   */

  let { query }: { query: string } = $props();

  const tasks = $derived(filteredTasks(query));
  const todayKey = dayKey(new Date());

  /** Tasks by due day. */
  const byDay = $derived.by(() => {
    const m = new Map<string, TaskRef[]>();
    for (const t of tasks) if (t.item.due) m.set(t.item.due, [...(m.get(t.item.due) ?? []), t]);
    return m;
  });
  const undated = $derived(tasks.filter((t) => !t.item.due).length);
  const overdue = $derived(tasks.filter((t) => !t.done && t.days !== null && t.days < 0));

  let selected = $state(todayKey);
  let month = $state(firstOf(new Date()));

  function firstOf(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  const title = $derived(month.toLocaleDateString(undefined, { month: "long", year: "numeric" }));
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }));

  /** Six weeks from the Monday on or before the 1st. */
  const days = $derived.by(() => {
    const offset = (month.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(month.getFullYear(), month.getMonth(), 1 - offset + i);
      const key = dayKey(d);
      return { key, day: d.getDate(), inMonth: d.getMonth() === month.getMonth(), tasks: byDay.get(key) ?? [] };
    });
  });

  // A dot per task, at most four; overdue first, then open, then done.
  const rank = (t: TaskRef) => (!t.done && t.days !== null && t.days < 0 ? 0 : t.done ? 2 : 1);
  const dots = (list: TaskRef[]) => [...list].sort((a, b) => rank(a) - rank(b)).slice(0, 4).map(rank);

  const dayTitle = $derived(
    (parseDay(selected) ?? new Date()).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }),
  );
  const dayTasks = $derived(byDay.get(selected) ?? []);

  function shift(months: number) {
    month = new Date(month.getFullYear(), month.getMonth() + months, 1);
    play("tap", { volume: 0.3, pitch: months > 0 ? 1.1 : 0.9 });
  }

  function pick(key: string) {
    selected = key;
    const d = parseDay(key);
    if (d && (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear())) month = firstOf(d);
    play("tap", { volume: 0.3, pitch: 1.05 });
  }

  const goToday = () => pick(todayKey);
  const goOverdue = () => overdue.length && pick([...overdue].sort((a, b) => (a.days ?? 0) - (b.days ?? 0))[0].item.due!);

  // ---------------------------------------------------------------- dragging a task to a day

  let drag = $state<{ task: TaskRef; x: number; y: number; over: string | null } | null>(null);
  let pressed: { task: TaskRef; x: number; y: number } | null = null;
  let dragged = false;

  function press(e: PointerEvent, task: TaskRef) {
    if (e.button !== 0) return;
    pressed = { task, x: e.clientX, y: e.clientY };
    dragged = false;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release, { once: true });
  }

  function move(e: PointerEvent) {
    if (!pressed) return;
    if (!drag && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < 5) return;
    if (!drag) play("tap", { volume: 0.35, pitch: 1.2 });
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-day]")?.dataset.day ?? null;
    if (drag && over !== drag.over && over) play("tap", { volume: 0.25, throttle: 40, pitch: 1.1 });
    drag = { task: pressed.task, x: e.clientX, y: e.clientY, over };
  }

  function release() {
    window.removeEventListener("pointermove", move);
    const d = drag;
    drag = null;
    pressed = null;
    if (!d) return;
    dragged = true;
    if (d.over && d.over !== d.task.item.due) {
      setDue(d.task.node.id, d.task.item.id, d.over);
      selected = d.over;
    }
  }

  // A click that ends a drag isn't a click.
  const click = (t: TaskRef) => (dragged ? (dragged = false) : showTask(t));

  const point = (id: string | null) => (ui.highlight = id ? new Set([id]) : new Set());
</script>

<div class="calendar">
  <div class="head">
    <button class="nav" aria-label="Previous month" onclick={() => shift(-1)}><ChevronLeft size={15} /></button>
    <span class="month">{title}</span>
    <button class="nav" aria-label="Next month" onclick={() => shift(1)}><ChevronRight size={15} /></button>
    <button class="chip" class:on={selected === todayKey} onclick={goToday}>Today</button>
    {#if overdue.length}
      <button class="chip overdue" {@attach tip("Go to the oldest overdue task")} onclick={goOverdue}>{overdue.length} overdue</button>
    {/if}
  </div>

  <div class="grid">
    {#each weekdays as w, i (i)}<span class="wd">{w}</span>{/each}
    {#each days as d (d.key)}
      <button
        class="day"
        class:out={!d.inMonth}
        class:today={d.key === todayKey}
        class:selected={d.key === selected}
        class:target={drag?.over === d.key}
        data-day={d.key}
        aria-label="{d.key}: {d.tasks.length} task{d.tasks.length === 1 ? '' : 's'}"
        onclick={() => pick(d.key)}
      >
        <span class="num">{d.day}</span>
        <span class="dots">
          {#each dots(d.tasks) as r, k (k)}<i class="r{r}"></i>{/each}
        </span>
      </button>
    {/each}
  </div>

  <div class="day-title">
    <span>{dayTitle}</span>
    {#if dayTasks.length}<span class="count">{dayTasks.length}</span>{/if}
  </div>
  <ul class="list" onpointerleave={() => point(null)}>
    {#each dayTasks as t (`${t.node.id}:${t.item.id}`)}
      <li class="task" class:done={t.done} class:moving={drag?.task === t} onpointerenter={() => point(t.node.id)}>
        <button class="check" class:on={t.done} aria-label={t.done ? "Uncheck" : "Check"} onclick={() => toggleTaskIn(t.node.id, t.item.id)}>
          {#if t.done}<Check size={11} strokeWidth={3} />{/if}
        </button>
        <button
          class="body"
          {@attach tip("Click to show it · double-click to edit · drag onto a day to move it")}
          onpointerdown={(e) => press(e, t)}
          onclick={() => click(t)}
          ondblclick={() => editTask(t)}
        >
          <span class="text">{t.item.text.trim() || "Task"}</span>
          <span class="where">{[t.list, ...t.path].join(" › ")}</span>
        </button>
      </li>
    {:else}
      <li class="empty">Nothing due{selected === todayKey ? " today" : ""}.</li>
    {/each}
  </ul>

  {#if undated}
    <button class="undated" onclick={() => ((settings.tasksView = "list"), (settings.tasksGroup = "due"))}>
      {undated} task{undated === 1 ? "" : "s"} without a date
    </button>
  {/if}
</div>

{#if drag}
  <div class="ghost" style:left="{drag.x + 12}px" style:top="{drag.y + 10}px">{drag.task.item.text.trim() || "Task"}</div>
{/if}

<style>
  .calendar {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 2px 8px 8px;
  }
  button {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 4px 0 6px;
  }
  .month {
    flex: 1;
    text-align: center;
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
  .chip {
    padding: 2px 8px;
    border-radius: calc(8px * var(--round));
    font-size: 11.5px;
    background: var(--control-bg);
    color: var(--text-muted);
  }
  .chip:hover,
  .chip.on {
    color: var(--text);
  }
  .chip.overdue {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
    color: var(--danger);
    font-weight: 600;
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
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    height: 38px;
    padding-top: 4px;
    border-radius: calc(7px * var(--round));
    font-variant-numeric: tabular-nums;
    transition: background 100ms;
  }
  .day:hover {
    background: var(--panel-hover);
  }
  .day.out .num {
    color: var(--text-muted);
    opacity: 0.55;
  }
  .day.today .num {
    color: var(--accent);
    font-weight: 700;
  }
  .day.today {
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  .day.selected {
    background: var(--accent-wash);
  }
  .day.target {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .num {
    font-size: 12.5px;
    line-height: 1;
  }
  .dots {
    display: flex;
    gap: 2px;
    height: 5px;
  }
  .dots i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
  }
  .dots .r0 {
    background: var(--danger);
  }
  .dots .r1 {
    background: var(--accent);
  }
  .dots .r2 {
    background: color-mix(in srgb, var(--text-muted) 55%, transparent);
  }
  .day-title {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 12px 4px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .count {
    font-variant-numeric: tabular-nums;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .task {
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: calc(7px * var(--round));
  }
  .task:hover {
    background: var(--panel-hover);
  }
  .task.moving {
    color: var(--text-muted);
  }
  .check {
    flex: none;
    display: grid;
    place-items: center;
    width: 15px;
    height: 15px;
    margin: 0 2px 0 4px;
    border-radius: calc(4px * var(--round));
    border: 1.5px solid color-mix(in srgb, var(--text-muted) 70%, transparent);
    color: var(--on-accent);
  }
  .check:hover {
    border-color: var(--accent);
  }
  .check.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 4px 4px 4px 0;
    cursor: grab;
  }
  .text,
  .where {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .where {
    font-size: 11px;
    color: var(--text-muted);
  }
  .done .text {
    color: color-mix(in srgb, currentColor 45%, transparent);
    text-decoration: line-through;
  }
  .empty {
    padding: 8px 6px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .undated {
    margin-top: 6px;
    padding: 6px;
    border-radius: calc(6px * var(--round));
    font-size: 12px;
    color: var(--text-muted);
  }
  .undated:hover {
    background: var(--panel-hover);
    color: var(--text);
  }
  .ghost {
    position: fixed;
    z-index: 130;
    max-width: 220px;
    padding: 4px 10px;
    border-radius: calc(8px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 8px 24px var(--panel-shadow);
    font-size: 12.5px;
    pointer-events: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
