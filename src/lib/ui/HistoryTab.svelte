<script lang="ts">
  import {
    Circle,
    FilePlus2,
    FlipHorizontal2,
    FolderOpen,
    Frame,
    Move,
    Palette,
    Pencil,
    Plus,
    Repeat,
    Scaling,
    Spline,
    Trash2,
  } from "@lucide/svelte";
  import type { Component } from "svelte";
  import { scale } from "svelte/transition";
  import { doc, history, jumpTo, project, ui } from "../app.svelte";
  import { touchedNodes, type Entry } from "../doc/history.svelte";
  import { settings } from "../settings.svelte";

  /**
   * The undo history, oldest first: a "start" row (the board as opened), every step, the current
   * one highlighted and the ones that can be redone dimmed below it. Clicking a row jumps there
   * (undoing or redoing up to it); hovering one points out the nodes it touched.
   */

  /** An icon by what a step's label says it did; the first rule that matches wins. */
  const ICONS: [RegExp, Component][] = [
    [/colou?r/i, Palette],
    [/^(delete|cut|remove|ungroup)/i, Trash2],
    [/link|reconnect|arrow|reverse|pin link side|automatic sides/i, Spline],
    [/frame|collapse|expand|auto-fit/i, Frame],
    [/^(add|paste|duplicate|new)/i, Plus],
    [/^(move|align|distribute|tidy)/i, Move],
    [/scale|resize|rotate|normalize|native size|reset transform|font size|width/i, Scaling],
    [/flip/i, FlipHorizontal2],
    [/loop/i, Repeat],
    [/edit|rename|label|check|count|goal|step|indent|task/i, Pencil],
  ];
  const iconOf = (label: string) => ICONS.find(([re]) => re.test(label))?.[1] ?? Circle;

  // "just now", "4 min ago", "2 h ago"; ticks over every 20 s.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 20_000);
    return () => clearInterval(timer);
  });
  function ago(time: number) {
    const s = (now - time) / 1000;
    if (s < 45) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(time).toLocaleDateString();
  }

  // A saved marker only for a board that has a file (a new board's start isn't "saved").
  const savedAt = $derived(project.path ? history.savedAt : null);

  function point(entry: Entry | null) {
    ui.highlight = entry ? new Set(touchedNodes(entry).filter((id) => doc.nodes[id])) : new Set();
  }

  // Keep the current row in view as the position changes.
  let list = $state<HTMLElement>();
  $effect(() => {
    const p = history.position;
    list?.querySelector(`[data-position="${p}"]`)?.scrollIntoView({ block: "nearest" });
  });

  $effect(() => () => point(null));

  const pop = (node: Element) => (settings.calm ? { duration: 0 } : scale(node, { start: 0.9, duration: 180 }));
</script>

<ol class="list" bind:this={list} onpointerleave={() => point(null)}>
  <li>
    <button
      class="row start"
      class:current={history.position === 0}
      data-position="0"
      onclick={() => jumpTo(0)}
      onpointerenter={() => point(null)}
    >
      <span class="icon">{#if project.path}<FolderOpen size={14} />{:else}<FilePlus2 size={14} />{/if}</span>
      <span class="label">{project.path ? "Opened board" : "New board"}</span>
      {#if savedAt === 0}<span class="saved">Saved</span>{/if}
    </button>
  </li>
  {#each history.entries as entry, i (i)}
    {@const position = i + 1}
    {@const Icon = iconOf(entry.label)}
    <li in:pop>
      <button
        class="row"
        class:current={history.position === position}
        class:future={position > history.position}
        data-position={position}
        onclick={() => jumpTo(position)}
        onpointerenter={() => point(entry)}
      >
        <span class="icon"><Icon size={14} /></span>
        <span class="label">{entry.label}</span>
        {#if savedAt === position}<span class="saved">Saved</span>{/if}
        <span class="time">{ago(entry.time)}</span>
      </button>
    </li>
  {/each}
  {#if !history.entries.length}
    <li class="empty">No changes yet. Every change you make shows up here.</li>
  {/if}
</ol>

<style>
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    margin: 0;
    padding: 6px;
    list-style: none;
  }
  .row {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: calc(7px * var(--round));
    cursor: pointer;
    transition:
      background 100ms,
      opacity 120ms;
  }
  .row:hover {
    background: var(--panel-hover);
  }
  .row.current {
    background: var(--accent-wash);
    color: var(--accent);
  }
  .row.future {
    opacity: 0.45;
  }
  .row.future:hover {
    opacity: 0.8;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 16px;
    flex-shrink: 0;
    color: var(--text-muted);
  }
  .current .icon {
    color: inherit;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .start .label {
    color: var(--text-muted);
  }
  .start.current .label {
    color: inherit;
  }
  .saved {
    flex-shrink: 0;
    padding: 0 6px;
    border-radius: calc(5px * var(--round));
    font-size: 11px;
    background: var(--control-bg);
    color: var(--text-muted);
  }
  .time {
    flex-shrink: 0;
    font-size: 11.5px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .empty {
    padding: 10px 8px;
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
