<script lang="ts">
  import { relinkMissing } from "../storage.svelte";
  import { untrack } from "svelte";
  import { camera } from "../app.svelte";
  import { backend, type Level } from "../backend";
  import type { Asset, CanvasNode } from "../doc/types";
  import { settings } from "../settings.svelte";
  import { levelRank, pickLevel } from "./lod";
  import { focusOf, slotOf } from "./slot";

  let { node, asset }: { node: CanvasNode; asset: Asset } = $props();

  const slot = $derived(slotOf(node));
  const focus = $derived(focusOf(node));

  let shown = $state<{ url: string; level: Level } | null>(null);
  let failed = $state(false);

  /** Drawn larger than its real pixels, with the "sharp pixels" setting on. */
  const sharp = $derived(
    settings.pixelated &&
      Math.max(node.w, node.h) * camera.zoom * window.devicePixelRatio > Math.max(asset.width, asset.height),
  );

  /** The longest side of the picture as drawn: a filled picture is larger than its box. */
  const drawn = $derived.by(() => {
    if (slot !== "fill" || !asset.width || !asset.height) return Math.max(node.w, node.h);
    const k = Math.max(node.w / asset.width, node.h / asset.height);
    return Math.max(asset.width, asset.height) * k;
  });

  const level = $derived(asset.missing ? null : pickLevel(asset, drawn * camera.zoom * window.devicePixelRatio));

  // Swap levels only once the new one is decoded, so zooming never flashes empty.
  // Upgrades wait briefly (zoom gestures pass through many levels); downgrades wait
  // longer, then free the larger bitmap.
  $effect(() => {
    if (level === null) return;
    const url = backend.assetUrl(asset, level);
    const current = untrack(() => shown);
    if (current?.url === url) return;

    const upgrade = levelRank(level) > levelRank(current?.level ?? null);
    const delay = !current ? 0 : upgrade ? 120 : 1500;
    let cancelled = false;
    const timer = setTimeout(() => {
      const img = new Image();
      img.src = url;
      img.decode().then(
        () => {
          if (cancelled) return;
          shown = { url, level };
          failed = false;
        },
        () => {
          if (!cancelled && !current) failed = true;
        },
      );
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });
</script>

<!-- A missing file shows as missing even when a picture of it was already up (the board reloaded). -->
{#if shown && !asset.missing}
  <img
    src={shown.url}
    alt={asset.name}
    draggable="false"
    class:sharp
    style:object-fit={slot ? (slot === "fill" ? "cover" : "contain") : null}
    style:object-position={slot === "fill" ? `${focus.x * 100}% ${focus.y * 100}%` : null}
  />
{:else if failed || asset.missing}
  <div class="missing" style:font-size="{Math.max(8, Math.min(node.w, node.h) * 0.07)}px">
    <span>Missing file</span>
    <small>{asset.name}</small>
    {#if asset.missing}<button class="find" onpointerdown={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()} onclick={() => void relinkMissing()}>Find…</button>{/if}
  </div>
{:else}
  <div class="loading"></div>
{/if}

<style>
  img.sharp {
    image-rendering: pixelated;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    animation: fade-in 180ms ease-out;
  }
  .loading {
    width: 100%;
    height: 100%;
    background: var(--node-placeholder);
  }
  .missing {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.3em;
    padding: 1em;
    text-align: center;
    color: var(--text-muted);
    background: repeating-linear-gradient(45deg, var(--node-placeholder) 0 12px, transparent 12px 24px);
    border: 1px dashed var(--text-muted);
    overflow: hidden;
  }
  .missing small {
    font-size: 0.7em;
    word-break: break-all;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }

  /* "Find…" on a missing file: runs Find missing files (buttons don't inherit font-size). */
  .find {
    font: inherit;
    font-size: 0.8em;
    margin-top: 0.3em;
    padding: 0.25em 0.9em;
    border: none;
    border-radius: calc(0.4em * var(--round));
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    cursor: pointer;
  }
  .find:hover {
    filter: brightness(1.08);
  }
</style>
