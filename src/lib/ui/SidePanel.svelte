<script lang="ts">
  import { tip } from "./tips.svelte";
  import { X } from "@lucide/svelte";
  import { backOut } from "svelte/easing";
  import { fade, fly } from "svelte/transition";
  import { actions, actionTip } from "../actions.svelte";
  import { camera, ui } from "../app.svelte";
  import { settings } from "../settings.svelte";
  import HistoryTab from "./HistoryTab.svelte";
  import OutlineTab from "./OutlineTab.svelte";
  import TasksTab from "./TasksTab.svelte";
  import { openCount } from "../checklist/tasks.svelte";

  /**
   * The floating side panel on the right, with tabs (Outline, History; Tasks later). It
   * sits over the canvas; framing and jumps center in the part of the view it leaves uncovered.
   * Not a dialog: Esc keeps meaning "deselect", and it stays open while working.
   */

  const TABS = [
    { id: "outline", action: "showOutline" },
    { id: "tasks", action: "showTasks" },
    { id: "history", action: "showHistory" },
  ] as const;
  /** Room for three tabs and the close button. */
  const MIN_WIDTH = 340;
  const MAX_WIDTH = 560;
  /** Space between the panel and the window's edges. */
  const MARGIN = 12;

  /** Open tasks on the board, on the Tasks tab. */
  const openTasks = $derived(openCount());

  const width = $derived(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, settings.panelWidth)));

  // Tell the camera how much of the view the panel covers, for as long as it's open (and shown).
  $effect(() => {
    camera.insetRight = ui.chromeHidden ? 0 : width + MARGIN * 2;
    return () => (camera.insetRight = 0);
  });

  // Dragging the left edge resizes the panel.
  let resizing: { x: number; width: number } | null = null;
  function startResize(e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizing = { x: e.clientX, width };
  }
  function moveResize(e: PointerEvent) {
    if (!resizing) return;
    settings.panelWidth = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizing.width + resizing.x - e.clientX)));
  }

  // Slides in with a small spring; calm mode just fades.
  const enter = (node: Element) => (settings.calm ? fade(node, { duration: 120 }) : fly(node, { x: 40, duration: 320, easing: backOut }));
  const leave = (node: Element) => (settings.calm ? fade(node, { duration: 100 }) : fly(node, { x: 40, duration: 160 }));
</script>

<aside class="panel" style:width="{width}px" in:enter out:leave aria-label="Side panel">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="edge"
    {@attach tip("Drag to resize")}
    onpointerdown={startResize}
    onpointermove={moveResize}
    onpointerup={() => (resizing = null)}
    onpointercancel={() => (resizing = null)}
  ></div>
  <header>
    <div class="tabs" role="tablist">
      {#each TABS as tab (tab.id)}
        {@const a = actions[tab.action]}
        <button role="tab" class:on={ui.panel === tab.id} aria-selected={ui.panel === tab.id} {@attach tip(actionTip(tab.action))} onclick={() => (ui.panel = settings.panelTab = tab.id)}>
          {#if a.icon}<a.icon size={14} strokeWidth={1.9} />{/if}
          {a.label}
          {#if tab.id === "tasks" && openTasks}<span class="badge">{openTasks}</span>{/if}
        </button>
      {/each}
    </div>
    <button class="close" {@attach tip("Close")} aria-label="Close panel" onclick={() => (ui.panel = null)}>
      <X size={15} strokeWidth={1.8} />
    </button>
  </header>
  <div class="body">
    {#if ui.panel === "outline"}<OutlineTab />{:else if ui.panel === "tasks"}<TasksTab />{:else if ui.panel === "history"}<HistoryTab />{/if}
  </div>
</aside>

<style>
  .panel {
    position: absolute;
    right: 12px;
    top: 64px;
    bottom: 12px;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    border-radius: calc(14px * var(--round));
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    backdrop-filter: blur(12px);
    box-shadow: 0 10px 36px var(--panel-shadow);
    color: var(--text);
    font-size: 13px;
    z-index: 80;
    user-select: none;
  }
  .edge {
    position: absolute;
    left: -4px;
    top: 12px;
    bottom: 12px;
    width: 8px;
    cursor: ew-resize;
    z-index: 1;
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 8px 6px 10px;
    border-bottom: 1px solid var(--panel-border);
  }
  .tabs {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 2px;
  }
  button {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
  }
  .tabs button {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    padding: 4px 8px;
    white-space: nowrap;
    border-radius: calc(7px * var(--round));
    color: var(--text-muted);
    font-weight: 550;
    transition:
      background 120ms,
      color 120ms;
  }
  .tabs button:hover {
    color: var(--text);
  }
  .tabs button.on {
    background: var(--accent-wash);
    color: var(--accent);
  }
  .badge {
    min-width: 16px;
    padding: 0 4px;
    border-radius: 8px;
    font-size: 10.5px;
    line-height: 16px;
    text-align: center;
    background: var(--control-bg);
    font-variant-numeric: tabular-nums;
  }
  .close {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: calc(6px * var(--round));
    color: var(--text-muted);
  }
  .close:hover {
    background: var(--panel-hover);
    color: var(--text);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
