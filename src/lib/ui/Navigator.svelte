<script lang="ts">
  import { Focus, History, Keyboard, Leaf, ListTodo, ListTree, Map as MapIcon, Minus, Plus, Settings, Volume2, VolumeX } from "@lucide/svelte";
  import { actionTip, available, runAction } from "../actions.svelte";
  import { camera, doc, selection, ui } from "../app.svelte";
  import { settings } from "../settings.svelte";
  import Minimap from "./Minimap.svelte";
  import PinsButton from "./PinsButton.svelte";
  import TimerChip from "./TimerChip.svelte";
  import MissedTimers from "./MissedTimers.svelte";
  import { missedTimers, soonestTimer } from "../timer/timers.svelte";
  import { tip } from "./tips.svelte";

  /**
   * The bottom-left card: the minimap (when it's on) with the zoom controls under it, then the
   * status bar's toggles. With the minimap off it's a one-line status bar, zoom first.
   */

  /** The card's inner width with the minimap: the map fills it. */
  const MAP_WIDTH = 232;

  const showMap = $derived(settings.minimap && doc.nodeList.length > 0);
  const zoom = $derived(`${Math.round(camera.zoom * 100)}%`);
  /** A timer is running or was missed: its chip and the bell want room. */
  const timers = $derived(!!soonestTimer() || missedTimers().length > 0);
  const count = $derived(`${doc.nodeList.length} node${doc.nodeList.length === 1 ? "" : "s"}`);
</script>

<footer class="nav" class:with-map={showMap} style:--map-width="{MAP_WIDTH}px">
  {#if showMap}
    <Minimap width={MAP_WIDTH} />
    <div class="row">
      <button class="icon" {@attach tip(actionTip("zoomOut"))} aria-label="Zoom out" onclick={() => runAction("zoomOut")}><Minus size={14} strokeWidth={1.9} /></button>
      <button class="zoom" {@attach tip(actionTip("resetZoom"))} onclick={() => runAction("resetZoom")}>{zoom}</button>
      <button class="icon" {@attach tip(actionTip("zoomIn"))} aria-label="Zoom in" onclick={() => runAction("zoomIn")}><Plus size={14} strokeWidth={1.9} /></button>
      <button class="icon" disabled={!available("frame")} {@attach tip(actionTip("frame"))} aria-label="Zoom to fit" onclick={() => runAction("frame")}><Focus size={14} strokeWidth={1.9} /></button>
      <span class="grow"></span>
      <!-- One thing fits under the map: a running or missed timer first, then the selection's count, then the board's. -->
      {#if timers}
        <TimerChip />
        <MissedTimers />
      {:else if selection.size}<span class="sel">{selection.size} selected</span>{:else}<span>{count}</span>{/if}
    </div>
  {/if}
  <div class="row">
    {#if !showMap}
      <button class="zoom" {@attach tip(actionTip("resetZoom"))} onclick={() => runAction("resetZoom")}>{zoom}</button>
      <span>{count}</span>
      {#if selection.size}<span class="sel">{selection.size} selected</span>{/if}
      <span class="sep"></span>
    {/if}
    {#if !showMap}
      <TimerChip />
      <MissedTimers />
    {/if}
    <PinsButton />
    <button class="icon" class:on={ui.panel === "outline"} {@attach tip(actionTip("showOutline"))} aria-pressed={ui.panel === "outline"} onclick={() => runAction("showOutline")}>
      <ListTree size={15} strokeWidth={1.8} />
    </button>
    <button class="icon" class:on={ui.panel === "tasks"} {@attach tip(actionTip("showTasks"))} aria-pressed={ui.panel === "tasks"} onclick={() => runAction("showTasks")}>
      <ListTodo size={15} strokeWidth={1.8} />
    </button>
    <button class="icon" class:on={ui.panel === "history"} {@attach tip(actionTip("showHistory"))} aria-pressed={ui.panel === "history"} onclick={() => runAction("showHistory")}>
      <History size={15} strokeWidth={1.8} />
    </button>
    {#if showMap}<span class="grow"></span>{/if}
    <button class="icon" class:off={!settings.sound} {@attach tip(actionTip("toggleSound"))} aria-pressed={settings.sound} onclick={() => runAction("toggleSound")}>
      {#if settings.sound}<Volume2 size={15} strokeWidth={1.8} />{:else}<VolumeX size={15} strokeWidth={1.8} />{/if}
    </button>
    <button class="icon" class:on={settings.calm} {@attach tip(actionTip("toggleCalm"))} aria-pressed={settings.calm} onclick={() => runAction("toggleCalm")}>
      <Leaf size={15} strokeWidth={1.8} />
    </button>
    <button class="icon" class:on={settings.minimap} {@attach tip(actionTip("toggleMinimap"))} aria-pressed={settings.minimap} onclick={() => runAction("toggleMinimap")}>
      <MapIcon size={15} strokeWidth={1.8} />
    </button>
    <button class="icon" class:on={ui.shortcutsOpen} data-shortcuts-toggle {@attach tip(actionTip("showShortcuts"))} aria-pressed={ui.shortcutsOpen} onclick={() => runAction("showShortcuts")}>
      <Keyboard size={15} strokeWidth={1.8} />
    </button>
    <button class="icon" class:on={ui.settingsOpen} data-settings-toggle {@attach tip(actionTip("openSettings"))} aria-pressed={ui.settingsOpen} onclick={() => runAction("openSettings")}>
      <Settings size={15} strokeWidth={1.8} />
    </button>
  </div>
</footer>

<style>
  .nav {
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    align-self: flex-start;
    padding: 3px;
    border-radius: calc(10px * var(--round));
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    backdrop-filter: blur(12px);
    font-size: 12px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    user-select: none;
  }
  .nav.with-map {
    gap: 2px;
    width: calc(var(--map-width) + 6px);
    box-sizing: border-box;
    /* Solid like the map, which a frosted card would show through. */
    background: var(--panel-solid);
    box-shadow: 0 6px 24px var(--panel-shadow);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .with-map .row {
    flex-wrap: wrap;
  }
  .row > span {
    padding: 4px 8px;
  }
  .grow {
    flex: 1;
    padding: 0 !important;
  }
  button {
    all: unset;
    padding: 4px 8px;
    border-radius: calc(7px * var(--round));
    color: var(--text);
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--panel-hover);
  }
  button.zoom {
    min-width: 3.2em;
    text-align: center;
  }
  .with-map button.zoom {
    min-width: 3em;
    padding: 4px 2px;
  }
  .sel {
    color: var(--accent);
  }
  .sep {
    width: 1px;
    height: 14px;
    padding: 0 !important;
    margin: 0 3px;
    background: var(--panel-border);
  }
  button.icon {
    display: grid;
    place-items: center;
    padding: 4px;
    color: var(--text-muted);
    transition: scale 100ms;
  }
  button.icon:active:not(:disabled) {
    scale: 0.88;
  }
  button.icon:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button.icon.off {
    opacity: 0.6;
  }
  button.icon.on {
    color: var(--accent);
    background: var(--accent-wash);
  }
</style>
