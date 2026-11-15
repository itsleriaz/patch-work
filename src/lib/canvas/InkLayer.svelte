<script lang="ts">
  import { camera } from "../app.svelte";
  import { brushPx, currentTool, drawModifiers, drawUi } from "../drawing/draw.svelte";
  import { inkColor, MARKER_OPACITY, outline } from "../drawing/model";
  import { settings } from "../settings.svelte";
  import type { Interaction } from "./interaction.svelte";

  /**
   * Draw mode's screen-space layer, above the nodes: the stroke being drawn (world points under
   * the camera's transform, outside the camera layer) and the brush outline at the pointer.
   */
  let { ix }: { ix: Interaction } = $props();

  const live = $derived.by(() => {
    void drawUi.version;
    const l = drawUi.live;
    if (!l) return null;
    // The straight segment being aimed (Shift held) draws as part of the stroke.
    const points = l.ruler ? [...l.points, l.ruler] : l.points;
    const straight = l.ruler ? [...l.straight, l.points.length] : l.straight;
    return { d: outline({ ...l, straight }, points, false), color: inkColor(l.color), opacity: l.tool === "marker" ? MARKER_OPACITY : 1 };
  });

  const tool = $derived(currentTool());
  const r = $derived(brushPx(tool) / 2);
  const showBrush = $derived(!!drawUi.cursor && !ix.spaceHeld && !ix.panning);
</script>

<!-- Shift starts and ends a straight line while drawing, Ctrl/⌘ turns its snapping off: keys alone count, without moving. -->
<svelte:window onkeydown={drawModifiers} onkeyup={drawModifiers} />

<svg class="ink" aria-hidden="true">
  {#if live}
    <g transform="translate({camera.x} {camera.y}) scale({camera.zoom})">
      <path d={live.d} fill={live.color} fill-opacity={live.opacity} />
    </g>
  {/if}
  {#if showBrush && drawUi.cursor}
    {@const c = drawUi.cursor}
    {#if tool === "eraser"}
      <circle class="eraser" cx={c.x} cy={c.y} {r} />
    {:else}
      <!-- The brush's size and color, with a ring that reads on light and dark. -->
      <circle class="ring dark" cx={c.x} cy={c.y} r={Math.max(r, 2.5) + 2.5} />
      <circle class="ring" cx={c.x} cy={c.y} r={Math.max(r, 2.5) + 1.25} />
      <circle cx={c.x} cy={c.y} r={Math.max(r, 2.5)} fill={inkColor(settings.inkColor)} fill-opacity={tool === "marker" ? 0.6 : 1} />
    {/if}
  {/if}
</svg>

<style>
  .ink {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  /* No CSS filter for the shadow: two rings instead (filters can get compositing layers, §8). */
  .ring {
    fill: none;
    stroke: rgb(255 255 255 / 0.9);
    stroke-width: 1.5;
  }
  .ring.dark {
    stroke: rgb(0 0 0 / 0.35);
    stroke-width: 1;
  }
  .eraser {
    fill: rgb(255 255 255 / 0.25);
    stroke: var(--text);
    stroke-width: 1.5;
  }
</style>
