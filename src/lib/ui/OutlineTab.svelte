<script lang="ts">
  import { tip } from "./tips.svelte";
  import {
    AudioLines,
    ChevronDown,
    ChevronRight,
    FileText,
    Film,
    Castle,
    Clapperboard,
    Timer as TimerIcon,
    Palette,
    PenLine,
    Frame,
    ImageIcon,
    ListChecks,
    ListOrdered,
    Lock,
    MapPin,
    Search,
    Table as TableIcon,
    Type,
  } from "@lucide/svelte";
  import type { Component } from "svelte";
  import { available, runAction, setLocked } from "../actions.svelte";
  import { doc, linkSelection, selection, selectOnly, ui } from "../app.svelte";
  import { backend } from "../backend";
  import { counterUi } from "../counter/count.svelte";
  import type { CanvasNode } from "../doc/types";
  import { frames } from "../frame/frames.svelte";
  import { play } from "../juice/sound";
  import { FILTERS, flyToNode, inView, outlineRows, outlineUi, SORTS, type Row } from "../outline/outline.svelte";
  import { isMac } from "../platform";
  import { settings } from "../settings.svelte";
  import Dropdown from "./Dropdown.svelte";

  /**
   * The outliner: every node as a row, frames with their members nested. Selection syncs both
   * ways; double-click flies there; Enter or F2 renames; right-click opens the usual menu;
   * hovering points the node out (with an arrow at the screen edge when it's off-screen).
   */

  const ICONS: Record<CanvasNode["kind"], Component> = {
    image: ImageIcon,
    gif: ImageIcon,
    video: Film,
    audio: AudioLines,
    pdf: FileText,
    sprite: Clapperboard,
    timer: TimerIcon,
    drawing: PenLine,
    palette: Palette,
    map: Castle,
    text: Type,
    checklist: ListChecks,
    counter: ListOrdered,
    frame: Frame,
    pin: MapPin,
    table: TableIcon,
  };

  const rows = $derived(outlineRows());

  /** A picture's smallest level (or a video's poster), for a tiny thumbnail. */
  function thumb(n: CanvasNode): string | null {
    const asset = doc.assetOf(n);
    if (!asset || asset.missing) return null;
    if (n.kind === "image" || n.kind === "gif") return backend.assetUrl(asset, 256);
    if (n.kind === "video") return backend.posterUrl(asset);
    return null;
  }

  /** The node a row stands for on the canvas: a hidden member is shown by its collapsed frame. */
  const target = (row: Row) => (row.hidden ? (frames.owner.get(row.node.id) ?? row.node.id) : row.node.id);

  function select(e: MouseEvent, row: Row) {
    const id = target(row);
    const additive = e.shiftKey || (isMac ? e.metaKey : e.ctrlKey);
    if (additive) {
      linkSelection.clear();
      if (selection.has(id)) selection.delete(id);
      else selection.add(id);
    } else selectOnly([id]);
    play("select", { volume: 0.4 });
  }

  /** Renames the node like Enter does on the canvas (titles, labels, a card's text). */
  function rename(row: Row) {
    const id = target(row);
    selectOnly([id]);
    const node = doc.nodes[id];
    if (!node) return;
    // Editors live on the canvas: bring the node into view first.
    if (!inView(node)) flyToNode(id);
    if (node.kind === "counter") return void (counterUi.editing = { nodeId: id, field: "label" });
    const action = ["editFrameTitle", "editPinTitle", "editText", "editChecklist"].find((a) => available(a));
    if (action) runAction(action);
    else play("denied", { volume: 0.4 });
  }

  function menu(e: MouseEvent, row: Row) {
    e.preventDefault();
    const id = target(row);
    if (!selection.has(id)) selectOnly([id]);
    const n = doc.nodes[id];
    ui.menu = { x: e.clientX, y: e.clientY, world: n ? { x: n.x + n.w / 2, y: n.y + n.h / 2 } : { x: 0, y: 0 }, target: "selection" };
  }

  function toggleFold(e: MouseEvent, id: string) {
    e.stopPropagation();
    if (outlineUi.folded.has(id)) outlineUi.folded.delete(id);
    else outlineUi.folded.add(id);
    play("tap", { volume: 0.4, pitch: outlineUi.folded.has(id) ? 0.9 : 1.1 });
  }

  let list = $state<HTMLElement>();

  // Arrows move between rows; Enter or F2 renames. Handled here, so the canvas shortcuts don't
  // also run (Enter would start editing, and a focused button would click).
  function onKeydown(e: KeyboardEvent, row: Row) {
    const buttons = [...(list?.querySelectorAll<HTMLButtonElement>("button.row") ?? [])];
    const i = buttons.indexOf(e.currentTarget as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const next = buttons[i + (e.key === "ArrowDown" ? 1 : -1)];
      next?.focus();
      next?.click();
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      e.stopPropagation();
      rename(row);
    }
  }

  // A row selected on the canvas scrolls into view.
  $effect(() => {
    const first = [...selection.values()][0];
    if (first) list?.querySelector(`[data-row="${first}"]`)?.scrollIntoView({ block: "nearest" });
  });

  const point = (id: string | null) => (ui.highlight = id ? new Set([id]) : new Set());
  $effect(() => () => point(null));
</script>

<div class="tools">
  <label class="search">
    <Search size={13} strokeWidth={1.9} />
    <input bind:value={outlineUi.query} placeholder="Search" spellcheck="false" aria-label="Search the board" />
  </label>
  <div class="selects">
    <Dropdown bind:value={outlineUi.filter} options={FILTERS} label="Show" />
    <Dropdown bind:value={settings.outlineSort} options={SORTS} label="Order" />
  </div>
</div>

<ul class="list" bind:this={list} onpointerleave={() => point(null)}>
  {#each rows as row (row.node.id)}
    {@const Icon = ICONS[row.node.kind]}
    {@const src = thumb(row.node)}
    <li>
      <button
        class="row"
        style:padding-left={row.depth ? `${8 + row.depth * 22}px` : null}
        class:selected={selection.has(row.node.id)}
        class:context={row.context}
        class:hidden={row.hidden}
        data-row={row.node.id}
        {@attach tip(row.hidden && "Inside a collapsed frame")}
        onclick={(e) => select(e, row)}
        ondblclick={() => flyToNode(row.node.id)}
        oncontextmenu={(e) => menu(e, row)}
        onkeydown={(e) => onKeydown(e, row)}
        onpointerenter={() => point(target(row))}
      >
        {#if row.node.kind === "frame"}
          <span class="fold" role="presentation" onclick={(e) => toggleFold(e, row.node.id)} ondblclick={(e) => e.stopPropagation()}>
            {#if row.open}<ChevronDown size={13} />{:else}<ChevronRight size={13} />{/if}
          </span>
        {/if}
        <span class="icon">
          {#if src}<img {src} alt="" draggable="false" />{:else}<Icon size={14} />{/if}
        </span>
        <span class="name">{row.name}</span>
        {#if row.detail}<span class="detail">{row.detail}</span>{/if}
        {#if row.node.locked}
          <span
            class="lock"
            role="presentation"
            {@attach tip("Locked: click to unlock")}
            onclick={(e) => (e.stopPropagation(), setLocked(false, [row.node]), play("button", { volume: 0.45 }))}
            ondblclick={(e) => e.stopPropagation()}
          ><Lock size={12} /></span>
        {/if}
      </button>
    </li>
  {:else}
    <li class="empty">
      {#if doc.nodeList.length}Nothing matches.{:else}The board is empty. Everything you add shows up here.{/if}
    </li>
  {/each}
</ul>

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
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    margin: 0;
    padding: 4px 6px 6px;
    list-style: none;
  }
  .row {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 4px 8px;
    border-radius: calc(7px * var(--round));
    cursor: pointer;
  }
  .row:hover {
    background: var(--panel-hover);
  }
  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .row.selected {
    background: var(--accent-wash);
    color: var(--accent);
  }
  .row.context .name,
  .row.hidden {
    opacity: 0.55;
  }
  .fold {
    display: grid;
    place-items: center;
    width: 16px;
    margin-right: -3px;
    color: var(--text-muted);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    color: var(--text-muted);
  }
  .selected .icon {
    color: inherit;
  }
  .icon img {
    width: 20px;
    height: 20px;
    object-fit: cover;
    border-radius: calc(3px * var(--round));
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail {
    flex-shrink: 0;
    font-size: 11.5px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .lock {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    color: var(--text-muted);
  }
  .lock:hover {
    color: var(--text);
  }
  .empty {
    padding: 10px 8px;
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
