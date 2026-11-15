<script lang="ts" generics="T extends string">
  import { Check, ChevronDown } from "@lucide/svelte";
  import { scale } from "svelte/transition";
  import { play } from "../juice/sound";
  import { tip } from "./tips.svelte";

  /**
   * A small dropdown in the app's own colors. Native <select> lists are drawn by the system
   * (GTK on Linux) and clash with the theme, differently on every platform.
   * Keyboard: Enter, Space or ↓ opens; ↑/↓ move; Enter picks; Esc closes.
   */

  let {
    value = $bindable(),
    options,
    label,
  }: {
    value: T;
    options: [value: T, label: string][];
    /** Accessible name. */
    label: string;
  } = $props();

  let open = $state(false);
  let active = $state(0);
  let host = $state<HTMLDivElement>();
  let button = $state<HTMLButtonElement>();

  const current = $derived(options.find(([v]) => v === value)?.[1] ?? "");

  function show() {
    open = true;
    active = Math.max(0, options.findIndex(([v]) => v === value));
    play("tap", { volume: 0.35, pitch: 1.15 });
  }

  function pick(v: T) {
    value = v;
    open = false;
    button?.focus();
    play("tap", { volume: 0.4 });
  }

  function onKeydown(e: KeyboardEvent) {
    const keys = ["ArrowDown", "ArrowUp", "Enter", " ", "Escape", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    // Keys here never reach the canvas shortcuts.
    e.stopPropagation();
    if (!open) {
      if (e.key !== "Escape") show();
      else button?.blur();
      return;
    }
    if (e.key === "Escape") open = false;
    else if (e.key === "ArrowDown") active = (active + 1) % options.length;
    else if (e.key === "ArrowUp") active = (active - 1 + options.length) % options.length;
    else if (e.key === "Home") active = 0;
    else if (e.key === "End") active = options.length - 1;
    else pick(options[active][0]);
  }
</script>

<svelte:window onpointerdown={(e) => open && !host?.contains(e.target as Node) && (open = false)} />

<div class="dropdown" bind:this={host}>
  <button
    bind:this={button}
    class="trigger"
    class:open
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={label}
    {@attach tip(label)}
    onclick={() => (open ? (open = false) : show())}
    onkeydown={onKeydown}
  >
    <span class="current">{current}</span>
    <ChevronDown size={13} strokeWidth={2} />
  </button>
  {#if open}
    <ul class="list" role="listbox" aria-label={label} transition:scale={{ duration: 120, start: 0.95 }}>
      {#each options as [v, text], i (v)}
        <li role="option" aria-selected={v === value}>
          <button class:active={i === active} tabindex="-1" onclick={() => pick(v)} onpointerenter={() => (active = i)}>
            <span class="check">{#if v === value}<Check size={13} strokeWidth={2.2} />{/if}</span>
            {text}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .dropdown {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  button {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
  }
  .trigger {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px 4px 8px;
    border-radius: calc(6px * var(--round));
    background: var(--control-bg);
    border: 1px solid var(--panel-border);
    font-size: 12px;
    color: var(--text);
  }
  .trigger:hover,
  .trigger.open {
    background: var(--panel-hover);
  }
  .trigger:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .trigger :global(svg) {
    flex-shrink: 0;
    color: var(--text-muted);
    transition: rotate 150ms;
  }
  .trigger.open :global(svg) {
    rotate: 180deg;
  }
  .current {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .list {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 10;
    margin: 0;
    padding: 4px;
    list-style: none;
    border-radius: calc(8px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 8px 24px var(--panel-shadow);
    transform-origin: top center;
  }
  .list button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: calc(5px * var(--round));
    font-size: 12px;
    color: var(--text);
  }
  .list button.active {
    background: var(--accent);
    color: var(--on-accent);
  }
  .check {
    display: grid;
    place-items: center;
    width: 13px;
    flex-shrink: 0;
  }
</style>
