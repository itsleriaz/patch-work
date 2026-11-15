<script lang="ts" module>
  import type { Component } from "svelte";

  /** An action id, "-" for a separator, a submenu, a one-off item (e.g. a recent file), or a
   *  line of quiet text (e.g. a summary). */
  export type MenuEntry =
    | string
    | { note: string }
    | { label: string; icon?: Component; items: () => MenuEntry[] }
    | { label: string; icon?: Component; run: () => void; hint?: string; title?: string; checked?: boolean; key?: string };
</script>

<script lang="ts">
  import { tip } from "./tips.svelte";
  import { Check, ChevronRight } from "@lucide/svelte";
  import { tick } from "svelte";
  import { actions, available, runAction, shortcutOf, type ActionContext } from "../actions.svelte";
  import Menu from "./Menu.svelte";

  let {
    entries,
    ctx = {},
    onclose,
    onback,
    x = 0,
    y = 0,
  }: {
    entries: MenuEntry[];
    /** Passed to actions (e.g. the world point a context menu was opened at). */
    ctx?: ActionContext;
    /** Closes the whole menu tree. */
    onclose: () => void;
    /** Set for submenus: closes this one and returns focus to its parent item. */
    onback?: () => void;
    /** Client position, for the root menu. */
    x?: number;
    y?: number;
  } = $props();

  const sub = $derived(!!onback);

  type Item =
    | { kind: "sep" }
    | { kind: "note"; note: string }
    | { kind: "action"; id: string }
    | { kind: "sub"; label: string; icon?: Component; items: () => MenuEntry[] }
    | { kind: "custom"; label: string; icon?: Component; run: () => void; hint?: string; title?: string; checked?: boolean; key?: string };

  /** Whether a submenu has anything to show: an available action, a note, an item or a submenu that does. */
  function shows(list: MenuEntry[]): boolean {
    return list.some((e) => (e === "-" ? false : typeof e === "string" ? available(e) : "items" in e ? shows(e.items()) : true));
  }

  /** Available entries, with separators collapsed (no leading, trailing or doubled ones). */
  const items = $derived.by(() => {
    const out: Item[] = [];
    for (const e of entries) {
      if (e === "-") {
        if (out.length && out.at(-1)!.kind !== "sep") out.push({ kind: "sep" });
      } else if (typeof e === "string") {
        if (available(e)) out.push({ kind: "action", id: e });
      } else if ("note" in e) {
        out.push({ kind: "note", note: e.note });
      } else if ("items" in e) {
        if (shows(e.items())) out.push({ kind: "sub", ...e });
      } else {
        out.push({ kind: "custom", ...e });
      }
    }
    if (out.at(-1)?.kind === "sep") out.pop();
    return out;
  });

  let el = $state<HTMLDivElement>();
  let open = $state<number | null>(null);
  /** Submenus flip to the left / shift up when they'd leave the window. */
  let flip = $state(false);
  let lift = $state(0);

  // The root menu stays on screen; submenus are positioned by CSS next to their item.
  const position = $derived.by(() => {
    if (sub || !el) return { x, y };
    const w = el.offsetWidth, h = el.offsetHeight;
    return {
      x: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
      y: y + h > window.innerHeight - 8 ? Math.max(8, y - h) : y,
    };
  });

  $effect(() => {
    if (!el) return;
    if (sub) {
      const r = el.getBoundingClientRect();
      flip = r.right > window.innerWidth - 8;
      lift = Math.max(0, r.bottom - (window.innerHeight - 8));
    } else {
      el.focus({ preventScroll: true });
    }
  });

  function buttons() {
    return [...(el?.querySelectorAll<HTMLButtonElement>(":scope > .row > button") ?? [])];
  }

  async function openSub(i: number, focus: boolean) {
    open = i;
    if (!focus) return;
    await tick();
    el?.querySelector<HTMLButtonElement>(":scope > .row .menu button")?.focus();
  }

  function closeSub() {
    const i = open;
    open = null;
    if (i !== null) buttons()[itemsToButton(i)]?.focus();
  }

  const interactive = (it: Item) => it.kind !== "sep" && it.kind !== "note";

  /** Index among buttons for an item index (separators and notes have no button). */
  function itemsToButton(i: number) {
    return items.slice(0, i).filter(interactive).length;
  }

  function onKeydown(e: KeyboardEvent) {
    // Keys from an open submenu are its own business.
    if (e.target instanceof Node && e.target !== el && !buttons().includes(e.target as HTMLButtonElement)) return;
    const list = buttons();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const item = i >= 0 ? items.filter(interactive)[i] : undefined;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next]?.focus();
    } else if (e.key === "ArrowRight" && item?.kind === "sub") {
      e.preventDefault();
      void openSub(items.indexOf(item), true);
    } else if (e.key === "ArrowLeft" && onback) {
      e.preventDefault();
      e.stopPropagation();
      onback();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      // An item's own key (the quick-add menu's numbers) runs it; number keys go by position.
      const pressed = /^Digit([0-9])$/.exec(e.code)?.[1] ?? e.key.toLowerCase();
      const hit = items.find((it) => it.kind === "custom" && it.key === pressed);
      if (hit) {
        e.preventDefault();
        run(hit);
      }
    }
  }

  function run(item: Item) {
    if (item.kind === "action") {
      // Read ctx before closing: it's a live prop derived from the open menu, gone after onclose.
      const context = ctx;
      onclose();
      runAction(item.id, context);
    } else if (item.kind === "custom") {
      onclose();
      item.run();
    }
  }
</script>

<div
  class="menu"
  class:sub
  class:flip
  role="menu"
  tabindex="-1"
  bind:this={el}
  style:left={sub ? null : `${position.x}px`}
  style:top={sub ? `${-6 - lift}px` : `${position.y}px`}
  onkeydown={onKeydown}
  oncontextmenu={(e) => e.preventDefault()}
>
  {#each items as item, i (i)}
    {#if item.kind === "sep"}
      <div class="sep" role="separator"></div>
    {:else if item.kind === "note"}
      <div class="note">{item.note}</div>
    {:else}
      <div class="row">
        {#if item.kind === "action"}
          {@const action = actions[item.id]}
          <button role="menuitem" onclick={() => run(item)} onpointerenter={() => (open = null)} class:danger={item.id === "delete"}>
            <span class="icon">{#if action.icon}<action.icon size={15} strokeWidth={1.8} />{/if}</span>
            <span class="label">{action.label}</span>
            {#if action.active?.()}<span class="check"><Check size={14} strokeWidth={2.2} /></span>{/if}
            {#if shortcutOf(action)}<span class="keys">{shortcutOf(action)}</span>{/if}
          </button>
        {:else if item.kind === "sub"}
          <button
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === i}
            class:open={open === i}
            onclick={() => void openSub(i, true)}
            onpointerenter={() => void openSub(i, false)}
          >
            <span class="icon">{#if item.icon}<item.icon size={15} strokeWidth={1.8} />{/if}</span>
            <span class="label">{item.label}</span>
            <span class="chev"><ChevronRight size={14} strokeWidth={2} /></span>
          </button>
          {#if open === i}
            <Menu entries={item.items()} {ctx} {onclose} onback={closeSub} />
          {/if}
        {:else}
          <button role="menuitem" {@attach tip(item.title)} onclick={() => run(item)} onpointerenter={() => (open = null)}>
            <span class="icon">{#if item.icon}<item.icon size={15} strokeWidth={1.8} />{/if}</span>
            <span class="label">{item.label}</span>
            {#if item.checked}<span class="check"><Check size={14} strokeWidth={2.2} /></span>{/if}
            {#if item.hint}<span class="keys">{item.hint}</span>{/if}
          </button>
        {/if}
      </div>
    {/if}
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 100;
    min-width: 210px;
    max-width: 340px;
    padding: 5px;
    border-radius: calc(10px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 10px 32px var(--panel-shadow);
    font-size: 13px;
    user-select: none;
    transform-origin: top left;
    animation: menu-in 130ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
    outline: none;
  }
  .menu.sub {
    position: absolute;
    left: calc(100% + 4px);
  }
  .menu.sub.flip {
    left: auto;
    right: calc(100% + 4px);
    transform-origin: top right;
  }
  .row {
    position: relative;
  }
  button {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border-radius: calc(6px * var(--round));
    color: var(--text);
    cursor: default;
  }
  button:hover,
  button:focus-visible,
  button.open {
    background: var(--accent);
    color: var(--on-accent);
  }
  button:hover .keys,
  button:focus-visible .keys,
  button.open .chev {
    color: color-mix(in srgb, var(--on-accent) 75%, transparent);
  }
  .danger:hover,
  .danger:focus-visible {
    background: var(--danger);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 16px;
    flex-shrink: 0;
    opacity: 0.85;
  }
  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .check,
  .chev {
    display: grid;
    place-items: center;
    margin-left: 12px;
  }
  .chev {
    color: var(--text-muted);
  }
  .keys {
    color: var(--text-muted);
    font-size: 12px;
    margin-left: 16px;
    white-space: nowrap;
  }
  .note {
    padding: 4px 8px 5px 32px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--panel-border);
  }
  @keyframes menu-in {
    from {
      opacity: 0;
      scale: 0.94;
    }
  }
  :global(:root[data-calm]) .menu {
    animation-duration: 0.01ms;
  }
</style>
