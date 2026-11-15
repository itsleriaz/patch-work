<script lang="ts">
  import { tip } from "./tips.svelte";
  import { Check, Eraser, Highlighter, Palette as PaletteIcon, Pen } from "@lucide/svelte";
  import type { Component } from "svelte";
  import { scale } from "svelte/transition";
  import { doc } from "../app.svelte";
  import { paletteData } from "../palette/model";
  import { actionTip } from "../actions.svelte";
  import { exitDraw, setTool, type DrawTool } from "../drawing/draw.svelte";
  import { INK_COLORS, SIZES, type InkColor } from "../drawing/model";
  import { play } from "../juice/sound";
  import { settings } from "../settings.svelte";

  /**
   * Draw mode's tools: pen, marker, eraser; ink colors (the eight, then any color from a palette
   * on the board, through the palette button); brush sizes; done.
   */

  const TOOLS: [DrawTool, Component, string][] = [
    ["pen", Pen, "toolPen"],
    ["marker", Highlighter, "toolMarker"],
    ["eraser", Eraser, "toolEraser"],
  ];
  const COLORS = Object.entries(INK_COLORS) as [InkColor, { color: string; label: string }][];

  const tool = $derived(settings.inkTool);
  const sizeKey = $derived(tool === "pen" ? "penSize" : tool === "marker" ? "markerSize" : "eraserSize");
  const sizes = $derived(SIZES[tool]);

  function pickColor(c: InkColor) {
    settings.inkColor = c;
    // Picking a color means drawing: leave the eraser.
    if (settings.inkTool === "eraser") settings.inkTool = "pen";
    play("button", { volume: 0.4 });
  }

  /** The ink when it came from a palette (not one of the eight), shown after them. */
  const custom = $derived(settings.inkColor.startsWith("#") ? (settings.inkColor as InkColor) : null);

  /** The board's palettes with colors, in reading order: their swatches can be inks too. */
  const palettes = $derived(
    doc.nodeList
      .filter((n) => n.kind === "palette")
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((n) => ({ id: n.id, ...paletteData(n.data) }))
      .filter((p) => p.colors.length)
      .map((p) => ({ ...p, title: p.title || "Palette" })),
  );
  let paletteOpen = $state(false);

  function togglePalettes() {
    paletteOpen = !paletteOpen;
    play("tap", { pitch: paletteOpen ? 1.15 : 0.9 });
  }

  function pickSize(i: number) {
    settings[sizeKey] = i;
    play("tap", { volume: 0.4, pitch: 0.9 + i * 0.1 });
  }
</script>

<svelte:window
  onpointerdown={(e) => paletteOpen && !(e.target as HTMLElement).closest(".pop-host") && (paletteOpen = false)}
  onkeydowncapture={(e) => {
    // Esc closes the list first, before it ends draw mode.
    if (paletteOpen && e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      paletteOpen = false;
    }
  }}
/>

<div class="bar" role="toolbar" aria-label="Drawing tools">
  {#each TOOLS as [t, Icon, action] (t)}
    <button class:active={tool === t} aria-label={t} aria-pressed={tool === t} {@attach tip(actionTip(action))} onclick={() => setTool(t)}>
      <Icon size={17} strokeWidth={1.8} />
    </button>
  {/each}
  <span class="sep"></span>
  {#each COLORS as [key, c] (key)}
    <button
      class="color"
      class:on={settings.inkColor === key && tool !== "eraser"}
      aria-label={c.label}
      aria-pressed={settings.inkColor === key}
      {@attach tip(c.label)}
      onclick={() => pickColor(key)}
    >
      <span class="swatch" style:background={c.color}></span>
    </button>
  {/each}
  {#if custom}
    <button class="color" class:on={tool !== "eraser"} aria-label={custom} aria-pressed="true" {@attach tip(`${custom} (from a palette)`)} onclick={() => pickColor(custom)}>
      <span class="swatch" style:background={custom}></span>
    </button>
  {/if}
  {#if palettes.length}
    <div class="pop-host">
      <button class:active={paletteOpen} aria-label="Colors from palettes" aria-expanded={paletteOpen} {@attach tip("Colors from the board's palettes")} onclick={togglePalettes}>
        <PaletteIcon size={17} strokeWidth={1.8} />
      </button>
      {#if paletteOpen}
        <div class="palettes" role="menu" aria-label="Colors from palettes" transition:scale={{ duration: 140, start: 0.92 }}>
          {#each palettes as p (p.id)}
            <div class="group">
              <span class="name">{p.title}</span>
              <div class="row">
                {#each p.colors as c (c.id)}
                  <button class="color" class:on={settings.inkColor === c.hex} role="menuitem" aria-label={c.hex} {@attach tip(c.hex)} onclick={() => ((paletteOpen = false), pickColor(c.hex as InkColor))}>
                    <span class="swatch" style:background={c.hex}></span>
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
  <span class="sep"></span>
  {#each sizes as px, i (i)}
    <button class:active={settings[sizeKey] === i} aria-label={["Small", "Medium", "Large"][i]} {@attach tip({ text: `${["Small", "Medium", "Large"][i]} brush`, keys: "− / +" })} onclick={() => pickSize(i)}>
      <span class="dot" style:width="{Math.min(18, Math.max(4, px * (tool === "pen" ? 1.4 : 0.55)))}px" style:height="{Math.min(18, Math.max(4, px * (tool === "pen" ? 1.4 : 0.55)))}px"></span>
    </button>
  {/each}
  <span class="sep"></span>
  <button class="done" {@attach tip(actionTip("exitDraw"))} onclick={exitDraw}>
    <Check size={16} strokeWidth={2.2} /><span>Done</span>
  </button>
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
    flex-wrap: wrap;
    justify-content: center;
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
  .color {
    width: 24px;
  }
  .swatch {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.18);
    transition: box-shadow 120ms;
  }
  .color.on .swatch {
    box-shadow:
      inset 0 0 0 1px rgb(0 0 0 / 0.18),
      0 0 0 2px var(--panel-solid),
      0 0 0 3.5px var(--accent);
  }
  .pop-host {
    position: relative;
  }
  .palettes {
    position: absolute;
    top: 38px;
    left: 50%;
    translate: -50% 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 320px;
    overflow-y: auto;
    padding: 8px;
    border-radius: calc(10px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 8px 24px var(--panel-shadow);
    width: max-content;
    max-width: 248px;
  }
  .group .name {
    display: block;
    margin: 0 0 3px 4px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .group .row {
    display: flex;
    flex-wrap: wrap;
  }
  .dot {
    border-radius: 50%;
    background: currentColor;
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
