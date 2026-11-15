<script lang="ts">
  import { Layers, Pause, Play, Clapperboard } from "@lucide/svelte";
  import { camera } from "../app.svelte";
  import type { Asset, CanvasNode } from "../doc/types";
  import { maskOf, sequence, sheetPosition, spriteData, tagOf } from "../sprite/model";
  import { currentFrame, openSpriteMenu, seekSprite, spriteMeta, spriteUi, toggleSprite } from "../sprite/sprites.svelte";
  import { relinkMissing } from "../storage.svelte";
  import { tip } from "../ui/tips.svelte";
  import { backend } from "../backend";

  /**
   * An Aseprite sprite: one frame of its sheet (every frame in a grid, composited in Rust), shown
   * with hard pixels. The sheet only changes with the file or the layers shown; playing moves the
   * background position (paint-only). A new sheet is decoded before it replaces the old one, so
   * toggling a layer or saving in Aseprite never flashes.
   */
  let { node, asset }: { node: CanvasNode; asset: Asset } = $props();

  const id = $derived(node.id);
  const d = $derived(spriteData(node.data));
  const meta = $derived(asset.missing ? null : spriteMeta(asset));
  const ready = $derived(meta && meta !== "failed" ? meta : null);
  const url = $derived(ready ? backend.spriteSheetUrl(asset, maskOf(ready, d)) : null);

  let shown = $state<string | null>(null);
  $effect(() => {
    const next = url;
    if (!next || next === shown) return;
    let cancelled = false;
    const img = new Image();
    img.src = next;
    img.decode().then(
      () => !cancelled && (shown = next),
      () => !cancelled && (shown = next),
    );
    return () => (cancelled = true);
  });

  const tag = $derived(ready ? tagOf(ready, d) : undefined);
  const seq = $derived(ready ? sequence(ready, tag) : []);
  const frame = $derived(ready ? currentFrame(node, ready) : 0);
  const step = $derived(seq.length ? (spriteUi.steps.get(id) ?? 0) % seq.length : 0);
  const pos = $derived(ready ? sheetPosition(ready, frame) : null);
  const isPlaying = $derived(spriteUi.playing.has(id));

  // Controls keep a constant screen size and shed parts as the node gets small on screen.
  let hovered = $state(false);
  let scrubbing = $state(false);
  const screenWidth = $derived(node.w * camera.zoom);
  const showBar = $derived(screenWidth >= 150);
  const showCount = $derived(screenWidth >= 250);
  const showControls = $derived(!!ready && (hovered || scrubbing));

  function seekAt(e: PointerEvent) {
    const track = e.currentTarget as HTMLElement;
    const k = Math.min(0.9999, Math.max(0, e.offsetX / track.offsetWidth));
    seekSprite(id, Math.floor(k * seq.length));
  }
  function startSeek(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubbing = true;
    spriteUi.playing.delete(id);
    seekAt(e);
  }
</script>

<div class="sprite" role="presentation" onpointerenter={() => (hovered = true)} onpointerleave={() => (hovered = false)}>
  {#if asset.missing}
    <div class="placeholder missing">
      <span>Missing file</span><small>{asset.name}</small>
      <button class="find" onpointerdown={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()} onclick={() => void relinkMissing()}>Find…</button>
    </div>
  {:else if meta === "failed"}
    <div class="placeholder"><Clapperboard size={28} strokeWidth={1.5} /><small>Can't read {asset.name}</small></div>
  {:else if shown && pos}
    <div
      class="frame"
      style:background-image="url({shown})"
      style:background-size="{pos.cols * 100}% {pos.rows * 100}%"
      style:background-position="{pos.x}% {pos.y}%"
      style:transform={d.flipX || d.flipY ? `scale(${d.flipX ? -1 : 1}, ${d.flipY ? -1 : 1})` : null}
    ></div>
  {:else}
    <div class="placeholder"></div>
  {/if}

  {#if ready && !showControls && !isPlaying && showBar && seq.length > 1}
    <!-- A quiet corner mark, so a sprite reads as animated rather than a picture. -->
    <div class="kind" aria-hidden="true"><Play size={12} fill="currentColor" /></div>
  {/if}

  {#if showControls && showBar && ready}
    <!-- Controls handle their own pointer events, so clicks don't select or drag the node. -->
    <div class="controls" role="presentation" onpointerdown={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()}>
      <div class="bar">
        <button aria-label={isPlaying ? "Pause" : "Play"} onclick={() => toggleSprite(id)}>
          {#if isPlaying}<Pause size={15} fill="currentColor" />{:else}<Play size={15} fill="currentColor" />{/if}
        </button>
        <div
          class="track"
          role="slider"
          tabindex="-1"
          aria-label="Frame"
          aria-valuemin={0}
          aria-valuemax={seq.length - 1}
          aria-valuenow={step}
          onpointerdown={startSeek}
          onpointermove={(e) => scrubbing && seekAt(e)}
          onpointerup={() => (scrubbing = false)}
          onpointercancel={() => (scrubbing = false)}
        >
          <div class="rail" style:--tag={tag?.color ?? null}>
            <div class="fill" style:width="{seq.length > 1 ? (step / (seq.length - 1)) * 100 : 100}%"></div>
          </div>
        </div>
        {#if showCount}<span class="count">{frame + 1}/{ready.frames.length}</span>{/if}
        {#if ready.tags.length}
          <button class="tag" {@attach tip("Animation tag")} onclick={(e) => openSpriteMenu(e, id, "tags")}>{tag?.name ?? "All"}</button>
        {/if}
        {#if ready.layers.length > 1}
          <button aria-label="Layers" {@attach tip("Layers")} onclick={(e) => openSpriteMenu(e, id, "layers")}><Layers size={15} /></button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .sprite {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .frame {
    position: absolute;
    inset: 0;
    background-repeat: no-repeat;
    /* Pixel art: hard pixels at every zoom. */
    image-rendering: pixelated;
  }
  .placeholder {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5em;
    padding: 1em;
    color: var(--text-muted);
    background: var(--node-placeholder);
    text-align: center;
    overflow: hidden;
    font-size: calc(12px * var(--inv-zoom));
  }
  .placeholder small {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .find {
    font: inherit;
    padding: 0.25em 0.9em;
    border: none;
    border-radius: calc(0.4em * var(--round));
    background: var(--accent);
    color: var(--on-accent);
    cursor: pointer;
  }
  /* Sized in screen pixels: --inv-zoom undoes the camera's scale. Paint-only (HANDOFF §8). */
  .kind {
    position: absolute;
    right: 0.6em;
    bottom: 0.6em;
    font-size: calc(12px * var(--inv-zoom));
    width: 2em;
    height: 2em;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: #fff;
    background: rgb(20 20 24 / 0.55);
    pointer-events: none;
  }
  .kind :global(svg) {
    width: 1em;
    height: 1em;
    margin-left: 0.1em;
  }
  .controls {
    position: absolute;
    inset: 0;
    font-size: calc(12px * var(--inv-zoom));
    color: #fff;
    pointer-events: none;
  }
  .bar {
    position: absolute;
    left: 0.6em;
    right: 0.6em;
    bottom: 0.6em;
    display: flex;
    align-items: center;
    gap: 0.4em;
    height: 2.6em;
    padding: 0 0.5em;
    border-radius: calc(0.9em * var(--round));
    background: rgb(20 20 24 / 0.72);
    border: 1px solid rgb(255 255 255 / 0.1);
    box-shadow: 0 0.3em 1.2em rgb(0 0 0 / 0.25);
    pointer-events: auto;
  }
  button {
    flex: none;
    display: grid;
    place-items: center;
    min-width: 1.9em;
    height: 1.9em;
    padding: 0;
    border: none;
    border-radius: calc(0.5em * var(--round));
    background: none;
    color: rgb(255 255 255 / 0.85);
    cursor: pointer;
    /* Buttons don't inherit font-size, and every size here is in em of the screen-px font. */
    font: inherit;
    transition:
      color 100ms,
      background 100ms;
  }
  button :global(svg) {
    width: 1.25em;
    height: 1.25em;
  }
  button:hover {
    color: #fff;
    background: rgb(255 255 255 / 0.14);
  }
  .tag {
    max-width: 7em;
    padding: 0 0.5em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
    line-height: 1.9em;
  }
  .track {
    position: relative;
    flex: 1;
    min-width: 2em;
    height: 1.9em;
    display: flex;
    align-items: center;
    margin: 0 0.3em;
    cursor: pointer;
  }
  .rail {
    position: relative;
    width: 100%;
    height: 0.3em;
    border-radius: calc(0.15em * var(--round));
    background: rgb(255 255 255 / 0.25);
    overflow: hidden;
    pointer-events: none;
    transition: height 120ms ease-out;
  }
  .track:hover .rail {
    height: 0.45em;
  }
  .fill {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    background: var(--tag, var(--accent-base));
  }
  .count {
    flex: none;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    opacity: 0.9;
  }
</style>
