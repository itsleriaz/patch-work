<script lang="ts">
  import { untrack } from "svelte";
  import { camera } from "../app.svelte";
  import { hideTip, tipState } from "./tips.svelte";

  /** The one tooltip card (see tips.svelte.ts), placed in screen space next to its element. */

  const GAP = 8;
  const EDGE = 8;

  let w = $state(0);
  let h = $state(0);

  const current = $derived(tipState.current);

  // Below the element when it's in the top half of the window (the toolbar), above it otherwise
  // (the status bar); flipped when there's no room; always kept inside the window.
  const position = $derived.by(() => {
    if (!current || !w) return null;
    const r = current.rect;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (current.right) return { x: Math.min(r.right + GAP, vw - w - EDGE), y: Math.max(EDGE, Math.min(r.top + r.height / 2 - h / 2, vh - h - EDGE)), up: false };
    const below = r.bottom + GAP, above = r.top - GAP - h;
    const preferBelow = r.top + r.height / 2 < vh / 2;
    const fitsBelow = below + h <= vh - EDGE, fitsAbove = above >= EDGE;
    const y = preferBelow ? (fitsBelow || !fitsAbove ? below : above) : fitsAbove || !fitsBelow ? above : below;
    const x = Math.max(EDGE, Math.min(r.left + r.width / 2 - w / 2, vw - w - EDGE));
    return { x, y: Math.max(EDGE, Math.min(y, vh - h - EDGE)), up: y < r.top };
  });

  // A tip for something on the canvas would be left behind when the camera moves.
  $effect(() => {
    void [camera.x, camera.y, camera.zoom];
    // Only the camera counts: a tip appearing mustn't hide itself.
    untrack(() => tipState.current?.inCanvas && hideTip());
  });
</script>

{#if current}
  {#key current.rect}
    <div
      class="tip"
      class:up={position?.up}
      role="tooltip"
      bind:clientWidth={w}
      bind:clientHeight={h}
      style:left="{position?.x ?? -9999}px"
      style:top="{position?.y ?? -9999}px"
      style:visibility={position ? "visible" : "hidden"}
    >
      <span class="line">
        <span class="text">{current.content.text}</span>
        {#if current.content.keys}<kbd>{current.content.keys}</kbd>{/if}
      </span>
      {#if current.content.detail}<span class="detail">{current.content.detail}</span>{/if}
    </div>
  {/key}
{/if}

<style>
  .tip {
    position: fixed;
    z-index: 1000;
    max-width: 260px;
    padding: 5px 8px;
    box-sizing: border-box;
    border-radius: calc(7px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 4px 16px var(--panel-shadow);
    color: var(--text);
    font-size: 12px;
    line-height: 1.35;
    pointer-events: none;
    animation: tip-in 120ms ease-out;
  }
  .up {
    animation-name: tip-in-up;
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .text {
    font-weight: 500;
  }
  kbd {
    flex: none;
    margin-left: auto;
    padding: 0 5px;
    border-radius: calc(4px * var(--round));
    background: var(--panel-hover);
    color: var(--text-muted);
    font-family: inherit;
    font-size: 11px;
    line-height: 17px;
  }
  .detail {
    display: block;
    margin-top: 2px;
    color: var(--text-muted);
  }
  @keyframes tip-in {
    from {
      opacity: 0;
      translate: 0 -3px;
    }
  }
  @keyframes tip-in-up {
    from {
      opacity: 0;
      translate: 0 3px;
    }
  }
  :global(:root[data-calm]) .tip {
    animation: none;
  }
</style>
