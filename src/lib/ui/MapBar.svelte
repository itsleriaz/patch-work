<script lang="ts">
  import { tip } from "./tips.svelte";
  import { BrickWall, Brush, Check, ChevronDown, DoorClosed, Eraser, Footprints, Hash, Route, Search, SquareDashed, SquareSlash, Stamp, Trees, Type } from "@lucide/svelte";
  import type { Component } from "svelte";
  import { actionTip } from "../actions.svelte";
  import { exitMap, mapUi, setGround, setMapTool, setPathLook, setStamp, toggleMapGrid, type MapTool } from "../map/map.svelte";
  import Dropdown from "./Dropdown.svelte";
  import { MAP_STYLES, mapData, type MapStyle } from "../map/model";
  import { doc } from "../app.svelte";
  import { setMapStyle } from "../map/map.svelte";
  import { STAMP_GROUPS, STAMPS, stampDef } from "../map/stamps";
  import StampGlyph from "../canvas/StampGlyph.svelte";
  import { settings } from "../settings.svelte";
  import { isMac } from "../platform";

  /** Map editing's tools and Done, under the toolbar (like the draw bar). */

  const TOOLS: [MapTool, Component, string][] = [
    ["room", SquareDashed, "mapRoom"],
    ["brush", Brush, "mapBrush"],
    ["erase", Eraser, "mapErase"],
    ["wall", BrickWall, "mapWall"],
    ["diagonal", SquareSlash, "mapDiagonal"],
    ["door", DoorClosed, "mapDoor"],
    ["number", Hash, "mapNumber"],
    ["text", Type, "mapText"],
    ["stamp", Stamp, "mapStamp"],
    ["path", Route, "mapPath"],
    ["exterior", Trees, "mapExterior"],
  ];

  const HINTS: Record<MapTool, string> = {
    room: `Drag a room · ${isMac ? "⌥" : "Alt"} + drag cuts one out`,
    brush: "Drag to paint floor",
    erase: "Drag to erase floor",
    wall: `Drag along grid lines to build a wall · start on one (or ${isMac ? "⌥" : "Alt"}) to remove`,
    diagonal: "Click near a corner to cut it off (or, on empty cells, fill it in) · again to undo · drag along a row",
    door: "Click a wall or doorway: door, locked, secret, none",
    number: "Click a room to number it, again to remove",
    text: "Click to write a label · click one to edit, drag to move",
    stamp: `Click to stamp · click one to turn it, drag to move, ${isMac ? "⌥" : "Alt"} + click to remove`,
    exterior: `Drag to paint outside · ${isMac ? "⌥" : "Alt"} + drag erases`,
    path: `Drag a route · ${isMac ? "⇧" : "Shift"} through cell centers · click one to change it, ${isMac ? "⌥" : "Alt"} + click to remove`,
  };

  /** The stamp picker: open, and what's typed in its search. */
  let picking = $state(false);
  let query = $state("");
  const groups = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return STAMP_GROUPS.map(([g, title]) => [title, STAMPS.filter((s) => s.group === g && (!q || s.label.toLowerCase().includes(q)))] as const).filter(([, list]) => list.length);
  });

  function pick(id: string) {
    setStamp(id);
    picking = false;
    query = "";
  }

  let pickerEl = $state<HTMLElement>();
  function closeOutside(e: PointerEvent) {
    const t = e.target as HTMLElement;
    if (picking && !pickerEl?.contains(t) && !t.closest("[data-stamp-chip]")) picking = false;
  }
  const focus = (el: HTMLInputElement) => el.focus();
</script>

<svelte:window onpointerdown={closeOutside} /> 

<div class="bar" role="toolbar" aria-label="Map tools">
  {#each TOOLS as [t, Icon, action] (t)}
    <button class:active={mapUi.tool === t} aria-label={t} aria-pressed={mapUi.tool === t} {@attach tip(actionTip(action))} onclick={() => setMapTool(t)}>
      <Icon size={17} strokeWidth={1.8} />
    </button>
  {/each}
  {#if mapUi.tool === "exterior"}
    <!-- What the Exterior tool paints, and its brush size. -->
    <div class="size" role="radiogroup" aria-label="Exterior">
      {#each [["dirt", "Dirt", "#ebe1cc"], ["grass", "Grass", "#e2ead1"], ["water", "Water", "#d6e5f0"], ["road", "Road", "#eee4cf"]] as [mode, label, tint] (mode)}
        <button role="radio" aria-checked={settings.mapGround === mode} class:on={settings.mapGround === mode} onclick={() => setGround({ mode: mode as "dirt" })}>
          <span class="dot" style:background={tint} style:box-shadow="inset 0 0 0 1px rgb(0 0 0 / 0.25)"></span>{label}
        </button>
      {/each}
    </div>
    <div class="size" role="radiogroup" aria-label="Brush size">
      {#each ["S", "M", "L"] as label, i (i)}
        <button role="radio" aria-checked={settings.mapGroundSize === i} class:on={settings.mapGroundSize === i} onclick={() => setGround({ size: i })}>{label}</button>
      {/each}
    </div>
  {/if}
  {#if mapUi.tool === "path"}
    <!-- How new paths look: dashed, dotted or footprints; ink or red. -->
    <div class="size" role="radiogroup" aria-label="Path style">
      <button role="radio" aria-checked={settings.mapPathStyle === "dashed"} class:on={settings.mapPathStyle === "dashed"} {@attach tip("Dashed")} onclick={() => setPathLook({ style: "dashed" })}>– –</button>
      <button role="radio" aria-checked={settings.mapPathStyle === "dotted"} class:on={settings.mapPathStyle === "dotted"} {@attach tip("Dotted")} onclick={() => setPathLook({ style: "dotted" })}>···</button>
      <button role="radio" aria-checked={settings.mapPathStyle === "footprints"} class:on={settings.mapPathStyle === "footprints"} {@attach tip("Footprints")} aria-label="Footprints" onclick={() => setPathLook({ style: "footprints" })}><Footprints size={14} strokeWidth={2} /></button>
    </div>
    <div class="size" role="radiogroup" aria-label="Path color">
      <button role="radio" aria-checked={settings.mapPathColor === "ink"} class:on={settings.mapPathColor === "ink"} aria-label="Ink" {@attach tip("Ink")} onclick={() => setPathLook({ color: "ink" })}><span class="dot" style:background="#1f1e1c"></span></button>
      <button role="radio" aria-checked={settings.mapPathColor === "red"} class:on={settings.mapPathColor === "red"} aria-label="Red" {@attach tip("Red")} onclick={() => setPathLook({ color: "red" })}><span class="dot" style:background="#c8372d"></span></button>
    </div>
  {/if}
  {#if mapUi.tool === "stamp"}
    <!-- The stamp it places; opens the picker. -->
    <button class="chip" data-stamp-chip aria-expanded={picking} {@attach tip(stampDef(settings.mapStamp)?.label ?? "Pick a stamp")} onclick={() => (picking = !picking)}>
      <svg viewBox="-1.1 -1.1 2.2 2.2" width="20" height="20" aria-hidden="true"><StampGlyph kind={settings.mapStamp} /></svg>
      <ChevronDown size={13} strokeWidth={2} />
    </button>
  {/if}
  <span class="sep"></span>
  <!-- The painting grid: full cells or half cells. -->
  <div class="size" role="radiogroup" aria-label="Painting grid" {@attach tip(actionTip("mapGrid"))}>
    <button role="radio" aria-checked={settings.mapGrid === "full"} class:on={settings.mapGrid === "full"} onclick={() => settings.mapGrid !== "full" && toggleMapGrid()}>Full</button>
    <button role="radio" aria-checked={settings.mapGrid === "half"} class:on={settings.mapGrid === "half"} onclick={() => settings.mapGrid !== "half" && toggleMapGrid()}>½</button>
  </div>
  <!-- The map's look: the whole map. -->
  <div class="style-pick">
  <Dropdown
    bind:value={
      () => (mapUi.editing && doc.nodes[mapUi.editing] ? mapData(doc.nodes[mapUi.editing].data).style : "oldschool") as MapStyle,
      (v) => setMapStyle(v)
    }
    options={MAP_STYLES.map((s) => [s.id, s.label] as [MapStyle, string])}
    label="Map style"
  />
  </div>
  <span class="hint">{HINTS[mapUi.tool]}</span>
  <span class="sep"></span>
  <button class="done" {@attach tip(actionTip("exitMap"))} onclick={exitMap}>
    <Check size={16} strokeWidth={2.2} /><span>Done</span>
  </button>

  {#if picking}
    <div class="picker" bind:this={pickerEl} role="dialog" aria-label="Stamps">
      <label class="search">
        <Search size={13} strokeWidth={1.9} />
        <input
          bind:value={query}
          placeholder="Search stamps"
          spellcheck="false"
          {@attach focus}
          onkeydown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") picking = false;
            if (e.key === "Enter" && groups[0]) pick(groups[0][1][0].id);
          }}
        />
      </label>
      <div class="groups">
        {#each groups as [title, list] (title)}
          <h4>{title}</h4>
          <div class="grid">
            {#each list as s (s.id)}
              <button class:on={s.id === settings.mapStamp} aria-label={s.label} {@attach tip(s.label)} onclick={() => pick(s.id)}>
                <svg viewBox="-1.1 -1.1 2.2 2.2" width="24" height="24" aria-hidden="true"><StampGlyph kind={s.id} /></svg>
              </button>
            {/each}
          </div>
        {:else}
          <p class="none">No stamp matches “{query}”.</p>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  /* In the toolbar's place (it steps aside while the mode is on), clear of the board pill. */
  .bar {
    position: absolute;
    top: 12px;
    left: 50%;
    translate: -50% 0;
    z-index: 85;
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 4px;
    border-radius: calc(12px * var(--round));
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    backdrop-filter: blur(12px);
    box-shadow: 0 6px 24px var(--panel-shadow);
    user-select: none;
    width: max-content;
    max-width: calc(100vw - 2 * var(--pill-width, 0px) - 48px);
    box-sizing: border-box;
    /* Many options (Exterior): wrap rather than run off the window. */
    flex-wrap: wrap;
    justify-content: center;
  }
  .hint {
    padding: 0 10px 0 8px;
    font-size: 12.5px;
    color: var(--text-muted);
    white-space: nowrap;
  }
  /* The dropdown takes the width it's given: wide enough for "Old-school" and its list. */
  .style-pick {
    flex: none;
    display: flex;
    width: 124px;
  }
  .sep {
    width: 1px;
    height: 20px;
    background: var(--panel-border);
    margin: 0 4px;
  }
  button {
    all: unset;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: calc(8px * var(--round));
    color: var(--text);
    cursor: pointer;
    transition:
      background 100ms,
      scale 100ms;
  }
  button:hover {
    background: var(--panel-hover);
  }
  button:active {
    scale: 0.9;
  }
  button.active {
    background: var(--accent-wash);
    color: var(--accent);
  }
  .size {
    display: flex;
    padding: 2px;
    gap: 2px;
    margin: 0 2px;
    border-radius: calc(7px * var(--round));
    background: var(--control-bg);
  }
  .size button {
    width: auto;
    height: 24px;
    padding: 0 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    border-radius: calc(5px * var(--round));
  }
  .size button.on {
    background: var(--panel-solid);
    color: var(--text);
    box-shadow: 0 1px 3px var(--panel-shadow);
  }
  .size button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .dot {
    display: block;
    width: 11px;
    height: 11px;
    border-radius: 50%;
  }
  .chip {
    display: flex;
    gap: 2px;
    width: auto;
    padding: 0 4px 0 6px;
    margin-left: 2px;
    background: var(--control-bg);
  }
  .picker {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    width: 320px;
    max-height: min(420px, calc(100vh - 160px));
    display: flex;
    flex-direction: column;
    border-radius: calc(12px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 12px 36px var(--panel-shadow);
    overflow: hidden;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px;
    padding: 5px 8px;
    border-radius: calc(7px * var(--round));
    background: var(--control-bg);
    color: var(--text-muted);
  }
  .search input {
    all: unset;
    flex: 1;
    min-width: 0;
    font-size: 13px;
    color: var(--text);
    user-select: text;
    -webkit-user-select: text;
  }
  .groups {
    overflow-y: auto;
    padding: 0 8px 10px;
  }
  h4 {
    margin: 8px 2px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
    gap: 2px;
  }
  .grid button {
    width: 36px;
    height: 36px;
  }
  .grid button.on {
    background: var(--accent-wash);
    color: var(--accent);
  }
  .none {
    margin: 6px 2px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .done {
    display: flex;
    gap: 5px;
    width: auto;
    padding: 0 10px 0 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
  }
</style>
