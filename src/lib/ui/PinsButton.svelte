<script lang="ts">
  import { tip } from "./tips.svelte";
  import { MapPin, MapPinned, Pencil, X } from "@lucide/svelte";
  import { scale } from "svelte/transition";
  import { actions, runAction, shortcutOf } from "../actions.svelte";
  import { ui } from "../app.svelte";
  import type { CanvasNode } from "../doc/types";
  import { play } from "../juice/sound";
  import { pinColor, pinData } from "../pin/model";
  import { deletePin, jumpToPin, pins, setPin } from "../pin/pins.svelte";

  /** The pin being renamed in the list. */
  let renaming = $state<string | null>(null);
  let host = $state<HTMLElement>();

  function toggle() {
    ui.pinsOpen = !ui.pinsOpen;
    renaming = null;
    play("tap", { pitch: ui.pinsOpen ? 1.15 : 0.9 });
  }

  function close(e: PointerEvent) {
    if (ui.pinsOpen && !host?.contains(e.target as Node)) ui.pinsOpen = false;
  }

  function focus(el: HTMLInputElement) {
    el.focus({ preventScroll: true });
    el.select();
  }

  function rename(pin: CanvasNode, value: string) {
    if (renaming !== pin.id) return;
    renaming = null;
    setPin(pin, "Rename pin", { title: value.trim() });
  }

  function onKeydown(e: KeyboardEvent, pin: CanvasNode) {
    if (e.key === "Enter") rename(pin, (e.target as HTMLInputElement).value);
    else if (e.key === "Escape") {
      e.stopPropagation();
      renaming = null;
    }
  }
</script>

<svelte:window
  onpointerdown={close}
  onkeydown={(e) => e.key === "Escape" && ui.pinsOpen && !renaming && (ui.pinsOpen = false)}
/>

<div class="host" bind:this={host}>
  <button
    class="icon"
    class:on={ui.pinsOpen}
    {@attach tip({ text: "Pins", keys: shortcutOf(actions.jumpToPin), detail: "Press a pin's number to jump there" })}
    aria-label="Pins"
    aria-expanded={ui.pinsOpen}
    onclick={toggle}
  >
    <MapPin size={15} strokeWidth={1.8} />
    {#if pins.list.length}<span class="count">{pins.list.length}</span>{/if}
  </button>

  {#if ui.pinsOpen}
    <section class="popover" aria-label="Pins" transition:scale={{ duration: 140, start: 0.92 }}>
      <header>Pins</header>
      {#each pins.list as pin (pin.id)}
        {@const d = pinData(pin.data)}
        <div class="row">
          {#if renaming === pin.id}
            <span class="num" style:background={pinColor(d)}>{d.slot}</span>
            <input
              value={d.title}
              placeholder="Pin {d.slot}"
              spellcheck="false"
              onkeydown={(e) => onKeydown(e, pin)}
              onblur={(e) => rename(pin, (e.target as HTMLInputElement).value)}
              {@attach focus}
            />
          {:else}
            <button class="jump" onclick={() => jumpToPin(d.slot)}>
              <span class="num" style:background={pinColor(d)}>{d.slot}</span>
              <span class="title" class:placeholder={!d.title}>{d.title || `Pin ${d.slot}`}</span>
            </button>
            <button class="tool" {@attach tip("Rename")} aria-label="Rename pin {d.slot}" onclick={() => (renaming = pin.id)}>
              <Pencil size={13} strokeWidth={1.8} />
            </button>
            <button class="tool danger" {@attach tip("Delete")} aria-label="Delete pin {d.slot}" onclick={() => deletePin(pin)}>
              <X size={14} strokeWidth={1.8} />
            </button>
          {/if}
        </div>
      {:else}
        <p class="empty">No pins yet. A pin saves a view to jump back to.</p>
      {/each}
      <button class="add" onclick={() => runAction("pinView")}>
        <MapPinned size={14} strokeWidth={1.8} />
        <span>Pin this view</span>
        <kbd>{shortcutOf(actions.pinView)}</kbd>
      </button>
      <p class="hint">Press a pin's number to jump there, and again to go back.</p>
    </section>
  {/if}
</div>

<style>
  .host {
    position: relative;
    display: grid;
    padding: 0 !important;
  }
  button {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
  }
  .icon {
    position: relative;
    display: grid;
    place-items: center;
    padding: 4px;
    border-radius: calc(7px * var(--round));
    color: var(--text-muted);
    transition: scale 100ms;
  }
  .icon:hover {
    background: var(--panel-hover);
  }
  .icon:active {
    scale: 0.88;
  }
  .icon.on {
    color: var(--accent);
    background: var(--accent-wash);
  }
  .count {
    position: absolute;
    right: -1px;
    top: -2px;
    min-width: 11px;
    height: 11px;
    padding: 0 2px;
    box-sizing: border-box;
    border-radius: 6px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 8px;
    font-weight: 700;
    line-height: 11px;
    text-align: center;
  }
  .popover {
    position: absolute;
    left: -4px;
    bottom: calc(100% + 10px);
    width: 250px;
    padding: 6px;
    border-radius: calc(10px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 10px 32px var(--panel-shadow);
    font-size: 13px;
    color: var(--text);
    transform-origin: bottom left;
  }
  header {
    padding: 2px 6px 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: calc(6px * var(--round));
  }
  .row:hover {
    background: var(--panel-hover);
  }
  .jump {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
  }
  .num {
    flex: none;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .row > .num {
    margin-left: 6px;
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .placeholder {
    color: var(--text-muted);
  }
  .tool {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: calc(6px * var(--round));
    color: var(--text-muted);
    opacity: 0;
  }
  .row:hover .tool,
  .tool:focus-visible {
    opacity: 1;
  }
  .tool:hover {
    background: var(--panel-border);
    color: var(--text);
  }
  .tool.danger:hover {
    background: var(--danger);
    color: var(--on-accent);
  }
  input {
    flex: 1;
    min-width: 0;
    margin: 3px 4px 3px 8px;
    padding: 2px 6px;
    font: inherit;
    color: var(--text);
    background: var(--control-bg);
    border: none;
    border-radius: calc(5px * var(--round));
    outline: 1.5px solid var(--accent);
  }
  .empty {
    margin: 0;
    padding: 4px 6px 8px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .add {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    margin-top: 4px;
    padding: 6px;
    border-top: 1px solid var(--panel-border);
    border-radius: 0 0 calc(6px * var(--round)) calc(6px * var(--round));
    color: var(--text);
  }
  .add:hover {
    background: var(--accent);
    color: var(--on-accent);
  }
  .add span {
    flex: 1;
  }
  kbd {
    font-family: inherit;
    font-size: 11px;
    color: inherit;
    opacity: 0.7;
  }
  .hint {
    margin: 4px 6px 2px;
    font-size: 11px;
    color: var(--text-muted);
  }
</style>
