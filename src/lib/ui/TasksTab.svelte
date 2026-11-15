<script lang="ts">
  import { tip } from "./tips.svelte";
  import { CalendarDays, CalendarPlus, Check, List, Search } from "@lucide/svelte";
  import { doc, ui } from "../app.svelte";
  import { dueLabel } from "../checklist/model";
  import { checklistUi, toggleTaskIn } from "../checklist/state.svelte";
  import { editTask, GROUPS, showTask, TASK_FILTERS, taskRows, type TaskRef } from "../checklist/tasks.svelte";
  import { play } from "../juice/sound";
  import { settings } from "../settings.svelte";
  import Dropdown from "./Dropdown.svelte";
  import CalendarView from "./CalendarView.svelte";

  /**
   * Every task on the board, grouped by due date (or by checklist), filtered to open, all or
   * done. Check tasks right here; click one to fly to its checklist and point it out; double-click
   * to edit it; the due chip opens the date picker.
   */

  let query = $state("");
  const rows = $derived(taskRows(query));
  const any = $derived(doc.nodeList.some((n) => n.kind === "checklist"));

  const show = showTask;
  const edit = editTask;

  function pickDue(e: MouseEvent, t: TaskRef) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    checklistUi.datePicker = { nodeId: t.node.id, itemId: t.item.id, x: r.left, y: r.bottom + 6 };
    play("tap", { volume: 0.4, pitch: 1.15 });
  }

  const point = (id: string | null) => (ui.highlight = id ? new Set([id]) : new Set());
  $effect(() => () => point(null));

  const empty = $derived(
    !any
      ? "No tasks yet. Every checklist's tasks show up here."
      : query.trim()
        ? "Nothing matches."
        : settings.tasksFilter === "done"
          ? "Nothing done yet."
          : settings.tasksFilter === "open"
            ? "Nothing left to do. 🎉"
            : "No tasks yet.",
  );
</script>

<div class="tools">
  <label class="search">
    <Search size={13} strokeWidth={1.9} />
    <input bind:value={query} placeholder="Search tasks" spellcheck="false" aria-label="Search tasks" />
  </label>
  <div class="selects">
    <Dropdown bind:value={settings.tasksFilter} options={TASK_FILTERS} label="Show" />
    <!-- Grouping is the list's; the calendar groups by day. -->
    {#if settings.tasksView === "list"}<Dropdown bind:value={settings.tasksGroup} options={GROUPS} label="Group" />{/if}
    <div class="views" role="radiogroup" aria-label="View">
      <button role="radio" aria-checked={settings.tasksView === "list"} class:on={settings.tasksView === "list"} {@attach tip("List")} aria-label="List" onclick={() => (settings.tasksView = "list")}><List size={14} /></button>
      <button role="radio" aria-checked={settings.tasksView === "calendar"} class:on={settings.tasksView === "calendar"} {@attach tip("Calendar")} aria-label="Calendar" onclick={() => (settings.tasksView = "calendar")}><CalendarDays size={14} /></button>
    </div>
  </div>
</div>

{#if settings.tasksView === "calendar"}
  <CalendarView {query} />
{:else}
<ul class="list" onpointerleave={() => point(null)}>
  {#each rows as row (row.key)}
    {#if row.kind === "section"}
      <li class="section {row.tone ?? ''}"><span>{row.label}</span><span class="count">{row.count}</span></li>
    {:else if row.kind === "parent"}
      <li class="parent" style:padding-left="{10 + row.depth * 16}px">{row.label}</li>
    {:else}
      {@const t = row.task}
      <li class="task" class:done={t.done} style:padding-left="{4 + row.depth * 16}px" onpointerenter={() => point(t.node.id)}>
        <button class="check" class:on={t.done} aria-label={t.done ? "Uncheck" : "Check"} onclick={() => toggleTaskIn(t.node.id, t.item.id)}>
          {#if t.done}<Check size={11} strokeWidth={3} />{/if}
        </button>
        <button class="body" onclick={() => show(t)} ondblclick={() => edit(t)}>
          <span class="text">{t.item.text.trim() || "Task"}</span>
          <!-- Where it is: the checklist and its parents (grouped by checklist, the headers say it). -->
          {#if settings.tasksGroup === "due"}
            <span class="where">{[t.list, ...t.path].join(" › ")}</span>
          {/if}
        </button>
        {#if t.item.due}
          <button
            class="due"
            class:overdue={!t.done && t.days !== null && t.days < 0}
            class:soon={!t.done && (t.days === 0 || t.days === 1)}
            {@attach tip("Due date")}
            onclick={(e) => pickDue(e, t)}
          >{dueLabel(t.item.due)}</button>
        {:else}
          <button class="due-add" {@attach tip("Set a due date")} aria-label="Set a due date" onclick={(e) => pickDue(e, t)}>
            <CalendarPlus size={13} />
          </button>
        {/if}
      </li>
    {/if}
  {:else}
    <li class="empty">{empty}</li>
  {/each}
</ul>
{/if}

<style>
  .tools {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 8px 4px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: calc(7px * var(--round));
    background: var(--control-bg);
    color: var(--text-muted);
  }
  .search input {
    all: unset;
    flex: 1;
    min-width: 0;
    color: var(--text);
    user-select: text;
    -webkit-user-select: text;
  }
  .search input::placeholder {
    color: var(--text-muted);
  }
  .selects {
    display: flex;
    gap: 6px;
  }
  .views {
    display: flex;
    flex: none;
    padding: 2px;
    gap: 2px;
    border-radius: calc(7px * var(--round));
    background: var(--control-bg);
  }
  .views button {
    display: grid;
    place-items: center;
    width: 26px;
    height: 22px;
    border-radius: calc(5px * var(--round));
    color: var(--text-muted);
  }
  .views button:hover {
    color: var(--text);
  }
  .views button.on {
    background: var(--panel-solid);
    color: var(--text);
    box-shadow: 0 1px 3px var(--panel-shadow);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    margin: 0;
    padding: 2px 6px 8px;
    list-style: none;
  }
  button {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
  }
  .section {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin: 10px 4px 3px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .section.overdue {
    color: var(--danger);
  }
  .section.soon {
    color: var(--accent);
  }
  .count {
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }
  .parent {
    padding: 4px 8px 1px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .task {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-right: 4px;
    border-radius: calc(7px * var(--round));
  }
  .task:hover {
    background: var(--panel-hover);
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
    padding: 4px 0;
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
  .where:empty {
    display: none;
  }
  .done .text {
    color: color-mix(in srgb, currentColor 45%, transparent);
    text-decoration: line-through;
  }
  .due {
    flex: none;
    padding: 1px 7px;
    border-radius: calc(8px * var(--round));
    font-size: 11px;
    background: var(--control-bg);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
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
  .done .due {
    opacity: 0.6;
  }
  .due-add {
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: calc(6px * var(--round));
    color: transparent;
  }
  .task:hover .due-add {
    color: var(--text-muted);
  }
  .due-add:hover {
    background: var(--panel-hover);
    color: var(--text) !important;
  }
  .empty {
    padding: 10px 8px;
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
