<svelte:options namespace="svg" />

<script lang="ts">
  import { shownNode } from "../frame/frames.svelte";
  import type { CanvasLink } from "../doc/types";
  import { linkPath } from "../links/geometry";
  import { LINK_COLORS, linkData, linkSides } from "../links/palette";

  let {
    link,
    selected,
    fresh,
    editing,
    relinking = false,
  }: { link: CanvasLink; selected: boolean; fresh: boolean; editing: boolean; relinking?: boolean } = $props();

  const data = $derived(linkData(link.data));
  // Recomputed only when one of the two nodes moves, resizes or rotates, or the shape changes.
  const path = $derived.by(() => {
    // An end hidden in a collapsed frame attaches to that frame.
    const a = shownNode(link.from), b = shownNode(link.to);
    return a && b ? linkPath(a, b, data.shape, linkSides(link.data)) : null;
  });
  const stroke = $derived(LINK_COLORS[data.color]?.stroke ?? LINK_COLORS.default.stroke);
</script>

{#if path}
  <g class="link" class:selected class:relinking class:dashed={data.dashed} style:--stroke={stroke} data-link-id={link.id}>
    <!-- Wide invisible stroke: an easy target to click. -->
    <path class="hit" d={path.d} />
    <path class="line" class:draw={fresh} d={path.d} pathLength={fresh ? 1 : undefined} />
    {#if data.arrow !== "none"}
      <path class="arrow" d="M0,0 L-11,-5 L-11,5 Z" style:transform="translate({path.to.p.x}px, {path.to.p.y}px) rotate({path.endAngle}deg) scale(var(--inv-zoom))" />
    {/if}
    {#if data.arrow === "both"}
      <path class="arrow" d="M0,0 L-11,-5 L-11,5 Z" style:transform="translate({path.from.p.x}px, {path.from.p.y}px) rotate({path.startAngle}deg) scale(var(--inv-zoom))" />
    {/if}
    {#if data.label && !editing}
      <text class="label" x={path.mid.x} y={path.mid.y}>{data.label}</text>
    {/if}
  </g>
{/if}

<style>
  /* Its end is being dragged elsewhere: the preview shows where it goes. */
  .relinking {
    opacity: 0.25;
  }
  .hit {
    fill: none;
    stroke: transparent;
    stroke-width: calc(14px * var(--inv-zoom));
    pointer-events: stroke;
    cursor: pointer;
  }
  .line {
    fill: none;
    stroke: var(--stroke);
    stroke-width: calc(2px * var(--inv-zoom));
    stroke-linecap: round;
    pointer-events: none;
    transition: stroke-width 120ms ease;
  }
  /* The width follows --inv-zoom, which steps while the camera moves: no easing then. */
  :global(:where(.camera.moving)) .line {
    transition: none;
  }
  .dashed .line {
    stroke-dasharray: calc(7px * var(--inv-zoom)) calc(6px * var(--inv-zoom));
  }
  .link:hover .line {
    stroke-width: calc(3px * var(--inv-zoom));
  }
  .selected .line,
  .selected .arrow {
    stroke: var(--accent);
  }
  .selected .line {
    stroke-width: calc(3px * var(--inv-zoom));
  }
  .arrow {
    fill: var(--stroke);
    stroke: var(--stroke);
    stroke-width: 1px;
    stroke-linejoin: round;
    pointer-events: none;
  }
  .selected .arrow {
    fill: var(--accent);
  }
  .label {
    font-size: 15px;
    font-weight: 500;
    text-anchor: middle;
    dominant-baseline: central;
    fill: var(--text);
    /* A halo in the canvas color cuts the line behind the text. */
    stroke: var(--canvas-bg);
    stroke-width: 7px;
    stroke-linejoin: round;
    paint-order: stroke;
    pointer-events: none;
  }
  .selected .label {
    fill: var(--accent);
  }
  /* New links draw themselves in from the source. */
  .draw {
    stroke-dasharray: 1;
    animation: draw 380ms cubic-bezier(0.3, 0.7, 0.4, 1) both;
  }
  @keyframes draw {
    from {
      stroke-dashoffset: 1;
    }
    to {
      stroke-dashoffset: 0;
    }
  }
  :global(:root[data-calm]) .draw {
    animation: none;
    stroke-dasharray: none;
  }
</style>
