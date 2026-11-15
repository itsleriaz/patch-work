<script lang="ts">
  import { tip } from "./tips.svelte";
  import { formatKeys } from "../actions.svelte";
  import {
    CaseSensitive,
    ChevronDown,
    ChevronUp,
    File,
    Frame,
    Hash,
    List,
    ListChecks,
    MapPin,
    Search,
    Spline,
    Table,
    Type,
    WholeWord,
    X,
  } from "@lucide/svelte";
  import { untrack, type Component } from "svelte";
  import { fly } from "svelte/transition";
  import { camera } from "../app.svelte";
  import { closeSearch, findMatches, findOptions, markWords, searchUi, showMatch, viewMiddle, type Match } from "../search/search.svelte";
  import { settings } from "../settings.svelte";

  /**
   * The find bar (Ctrl/⌘+F), floating under the toolbar. Typing points out the first match
   * (rings on every matching node, the words marked, an edge arrow when off-screen) without moving
   * the camera or the selection; Enter / ↓ goes to the next match (selecting it, flying there when
   * it's out of view), Shift+Enter / ↑ to the previous one. Every match is listed below (hover
   * points one out, click goes there). Esc closes.
   */

  const matches = $derived(findMatches(searchUi.query, findOptions(), searchUi.origin));
  const index = $derived(Math.min(searchUi.index, matches.length - 1));
  const current = $derived(matches.length ? matches[index] : undefined);

  // Every matching node gets a faint ring (kept up to date as the board changes).
  $effect(() => {
    searchUi.hits = new Set(matches.flatMap((m) => (m.node ? [m.node.id] : [])));
  });

  // A new query (or option) starts from the first match, measured from the middle of the view, and
  // points it out without flying there. Edits elsewhere on the board don't make it glow again.
  let last: string | null = null;
  $effect(() => {
    const key = JSON.stringify([searchUi.query, settings.findCase, settings.findWord, settings.findOrder]);
    untrack(() => {
      if (key === last) return;
      last = key;
      searchUi.origin = viewMiddle();
      searchUi.index = 0;
      searchUi.visited = false;
      showMatch(findMatches(searchUi.query, findOptions(), searchUi.origin)[0], false);
    });
  });

  // The matched words, marked in the nodes on screen; again shortly after the camera moves, since
  // nodes coming into view are only mounted then.
  let timer = 0;
  $effect(() => {
    void [camera.x, camera.y, camera.zoom];
    const now = { matches, current, query: searchUi.query, options: findOptions() };
    const paint = () => markWords(now.matches, now.current, now.query, now.options);
    clearTimeout(timer);
    timer = window.setTimeout(paint, 60);
    return () => clearTimeout(timer);
  });

  function go(dir: 1 | -1) {
    if (!matches.length) return;
    // The first Enter goes to the match being pointed out; after that, Enter moves on.
    if (searchUi.visited || dir < 0) searchUi.index = (index + dir + matches.length) % matches.length;
    searchUi.visited = true;
    showMatch(matches[searchUi.index], true);
  }

  function goTo(i: number) {
    searchUi.index = i;
    searchUi.visited = true;
    showMatch(matches[i], true);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeSearch();
    } else if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      go(e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey) ? -1 : 1);
    }
  }

  function focus(el: HTMLInputElement) {
    el.focus({ preventScroll: true });
    el.select();
  }

  // Ctrl/⌘+F again while open: back to the input, text selected.
  let input = $state<HTMLInputElement>();
  $effect(() => {
    void searchUi.focusKey;
    input?.focus({ preventScroll: true });
    input?.select();
  });

  // The current row stays in view in the list.
  let list = $state<HTMLElement>();
  $effect(() => {
    void index;
    list?.querySelector(".row.current")?.scrollIntoView({ block: "nearest" });
  });

  function toggle(key: "findCase" | "findWord" | "findList") {
    settings[key] = !settings[key];
    input?.focus({ preventScroll: true });
  }

  const ICONS: Record<string, Component> = {
    text: Type,
    checklist: ListChecks,
    table: Table,
    counter: Hash,
    frame: Frame,
    pin: MapPin,
    link: Spline,
  };
  const iconOf = (m: Match) => ICONS[m.kind] ?? File;

  const enter = (node: Element) => fly(node, { y: -8, duration: settings.calm ? 0 : 160 });
</script>

<div class="bar" role="search" transition:enter>
  <div class="line">
    <Search size={14} strokeWidth={1.9} />
    <input
      bind:this={input}
      bind:value={searchUi.query}
      placeholder="Find on the board"
      spellcheck="false"
      aria-label="Find on the board"
      onkeydown={onKeydown}
      {@attach focus}
    />
    <button class="opt" class:on={settings.findCase} {@attach tip("Match case")} aria-label="Match case" aria-pressed={settings.findCase} onclick={() => toggle("findCase")}>
      <CaseSensitive size={16} strokeWidth={1.8} />
    </button>
    <button class="opt" class:on={settings.findWord} {@attach tip("Whole word")} aria-label="Whole word" aria-pressed={settings.findWord} onclick={() => toggle("findWord")}>
      <WholeWord size={16} strokeWidth={1.8} />
    </button>
    <span class="count" class:none={searchUi.query.trim() && !matches.length}>
      {#if !searchUi.query.trim()}{:else if matches.length}{index + 1} of {matches.length}{:else}No results{/if}
    </span>
    <button {@attach tip({ text: "Previous match", keys: formatKeys("shift+enter") })} aria-label="Previous match" disabled={!matches.length} onclick={() => go(-1)}><ChevronUp size={15} /></button>
    <button {@attach tip({ text: "Next match", keys: formatKeys("enter") })} aria-label="Next match" disabled={!matches.length} onclick={() => go(1)}><ChevronDown size={15} /></button>
    <button class="opt" class:on={settings.findList} {@attach tip(settings.findList ? "Show only the current match" : "List every match")} aria-label="List every match" aria-pressed={settings.findList} onclick={() => toggle("findList")}>
      <List size={15} strokeWidth={1.8} />
    </button>
    <button {@attach tip({ text: "Close", keys: formatKeys("escape") })} aria-label="Close" onclick={closeSearch}><X size={15} /></button>
  </div>
  {#if current}
    <!-- Every match, or just the current one. Hovering points a match out; clicking goes there. -->
    <div class="list" class:all={settings.findList} bind:this={list} role="group" aria-label="Matches" onpointerleave={() => showMatch(current, false, false)}>
      {#each settings.findList ? matches : [current] as m, i (i)}
        {@const Icon = iconOf(m)}
        {@const at = settings.findList ? i : index}
        <button class="row" class:current={at === index} aria-current={at === index} onpointerenter={() => showMatch(m, false, false)} onclick={() => goTo(at)}>
          <span class="icon"><Icon size={13} strokeWidth={1.8} /></span>
          <span class="where">{m.where}</span>
          <span class="text">{m.before}<mark>{m.hit}</mark>{m.after}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .bar {
    position: absolute;
    top: 60px;
    left: 50%;
    translate: -50% 0;
    z-index: 85;
    width: min(460px, calc(100vw - 32px));
    box-sizing: border-box;
    padding: 5px 6px 5px 10px;
    border-radius: calc(10px * var(--round));
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    backdrop-filter: blur(12px);
    box-shadow: 0 6px 24px var(--panel-shadow);
    color: var(--text-muted);
    font-size: 13px;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  input {
    all: unset;
    flex: 1;
    min-width: 0;
    margin-left: 4px;
    padding: 3px 4px;
    color: var(--text);
    user-select: text;
    -webkit-user-select: text;
  }
  input::placeholder {
    color: var(--text-muted);
  }
  .count {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    padding: 0 4px;
  }
  .count.none {
    color: var(--danger);
  }
  button {
    all: unset;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: calc(6px * var(--round));
    cursor: pointer;
    color: var(--text-muted);
  }
  button:hover:not(:disabled) {
    background: var(--panel-hover);
    color: var(--text);
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .opt.on {
    background: var(--accent-wash);
    color: var(--accent);
  }
  .list {
    margin: 4px -2px 0 -6px;
    padding-top: 4px;
    border-top: 1px solid var(--panel-border);
  }
  /* About seven rows, then it scrolls. */
  .list.all {
    max-height: calc(7 * 26px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
    height: 26px;
    box-sizing: border-box;
    padding: 0 8px;
    font-size: 12px;
  }
  .row.current {
    background: var(--accent-wash);
  }
  .icon {
    flex: none;
    display: grid;
    color: var(--text-muted);
  }
  .row.current .icon {
    color: var(--accent);
  }
  .where {
    flex: none;
    max-width: 38%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  mark {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    color: inherit;
    border-radius: 3px;
    padding: 0 1px;
  }
</style>
