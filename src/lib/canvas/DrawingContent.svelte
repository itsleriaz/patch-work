<script lang="ts">
  import type { CanvasNode } from "../doc/types";
  import { drawUi } from "../drawing/draw.svelte";
  import { drawingData, inkColor, MARKER_OPACITY, strokePath } from "../drawing/model";

  let { node }: { node: CanvasNode } = $props();

  const d = $derived(drawingData(node.data));
</script>

<!-- Stretched to the node: a drawing scales like a picture. Only the strokes (and a few pixels
     around them) take the pointer, so a drawing over a picture doesn't hide the picture from clicks. -->
<svg viewBox="{d.view.x} {d.view.y} {d.view.w} {d.view.h}" preserveAspectRatio="none" aria-hidden="true">
  {#each d.strokes as s (s.id)}
    <path
      d={strokePath(s)}
      fill={inkColor(s.color)}
      fill-opacity={drawUi.erasing.has(`${node.id}:${s.id}`) ? 0.12 : s.tool === "marker" ? MARKER_OPACITY : 1}
    />
  {/each}
</svg>

<style>
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  path {
    pointer-events: all;
    stroke: transparent;
    stroke-width: 12px;
    vector-effect: non-scaling-stroke;
    stroke-linejoin: round;
  }
</style>
