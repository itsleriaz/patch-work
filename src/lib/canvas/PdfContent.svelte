<script lang="ts">
  import { relinkMissing } from "../storage.svelte";
  import { tip } from "../ui/tips.svelte";
  import { ChevronLeft, ChevronRight, FileText } from "@lucide/svelte";
  import { onDestroy, untrack } from "svelte";
  import { camera } from "../app.svelte";
  import type { Asset, CanvasNode } from "../doc/types";
  import { formatKeys } from "../actions.svelte";
  import { pdfLevel } from "../pdf/model";
  import { pageOf, stepPage } from "../pdf/pages.svelte";
  import { acquirePage, pdfErrors, pdfPages, prefetchPage, type PageImage } from "../pdf/pdf.svelte";

  let { node, asset, selected }: { node: CanvasNode; asset: Asset; selected: boolean } = $props();

  const pages = $derived(pdfPages.get(asset.hash));
  const error = $derived(pdfErrors.get(asset.hash));
  const page = $derived(pageOf(node));
  const level = $derived(asset.missing ? null : pdfLevel(Math.max(node.w, node.h) * camera.zoom * window.devicePixelRatio));

  /** The picture up now, and its hold on the cached render. */
  let shown = $state<{ url: string; page: number; level: number } | null>(null);
  let held: PageImage | undefined;
  onDestroy(() => held?.release());

  // Swap pictures only once the new one is decoded, so flipping and zooming never flash empty.
  // A new page shows as soon as it's ready; a sharper level waits briefly (zoom gestures pass
  // through many), a blurrier one longer.
  $effect(() => {
    if (level === null || error) return;
    const want = { page, level };
    const current = untrack(() => shown);
    if (current?.page === want.page && current.level === want.level) return;
    const delay = !current || current.page !== want.page ? 0 : want.level > current.level ? 120 : 1500;
    let cancelled = false;
    let image: PageImage | undefined;
    const timer = setTimeout(async () => {
      image = acquirePage(asset, want.page, want.level);
      const url = await image.url;
      if (cancelled || !url) return;
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {});
      if (cancelled) return;
      held?.release();
      held = image;
      image = undefined;
      shown = { url, ...want };
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      image?.release();
    };
  });

  let hovered = $state(false);

  // While someone's reading (pointer on it, or selected for the arrow keys), the next page renders ahead.
  $effect(() => {
    if ((hovered || selected) && shown && pages && level !== null && page + 1 < pages) prefetchPage(asset, page + 1, level);
  });

  // Controls keep a constant screen size and hide when the node is small on screen.
  const screenWidth = $derived(node.w * camera.zoom);
  const showBar = $derived(!!pages && pages > 1 && hovered && screenWidth >= 120);
  const showBadge = $derived(!!pages && pages > 1 && !showBar && screenWidth >= 90);

  function flip(e: MouseEvent, delta: number) {
    e.stopPropagation();
    stepPage(node.id, delta);
  }
</script>

<div class="pdf" role="presentation" onpointerenter={() => (hovered = true)} onpointerleave={() => (hovered = false)}>
  {#if asset.missing}
    <div class="placeholder missing">
      <span>Missing file</span>
      <small>{asset.name}</small>
      <button class="find" onpointerdown={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()} onclick={() => void relinkMissing()}>Find…</button>
    </div>
  {:else if error}
    <div class="placeholder"><FileText size={28} strokeWidth={1.5} /><span>{error}</span><small>{asset.name}</small></div>
  {:else if shown}
    <img src={shown.url} alt="{asset.name}, page {shown.page + 1}" draggable="false" />
  {:else}
    <div class="loading"></div>
  {/if}

  {#if showBadge}
    <div class="badge" aria-hidden="true">{page + 1} / {pages}</div>
  {/if}

  {#if showBar}
    <!-- The bar handles its own pointer events, so clicks don't select or drag the node. -->
    <div class="bar" role="presentation" onpointerdown={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()}>
      <button aria-label="Previous page" disabled={page === 0} {@attach tip({ text: "Previous page", keys: formatKeys("arrowleft") })} onclick={(e) => flip(e, -1)}>
        <ChevronLeft size={15} />
      </button>
      <span class="count">{page + 1} / {pages}</span>
      <button aria-label="Next page" disabled={page + 1 >= (pages ?? 0)} {@attach tip({ text: "Next page", keys: formatKeys("arrowright") })} onclick={(e) => flip(e, 1)}>
        <ChevronRight size={15} />
      </button>
    </div>
  {/if}
</div>

<style>
  .pdf {
    position: relative;
    width: 100%;
    height: 100%;
  }
  /* A page whose shape differs from the node's (documents can mix sizes) fits inside it. */
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .loading {
    width: 100%;
    height: 100%;
    background: var(--node-placeholder);
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
    font-size: max(8px, min(calc(14px * var(--inv-zoom)), 2.5em));
    color: var(--text-muted);
    background: var(--node-placeholder);
    text-align: center;
    overflow: hidden;
  }
  .placeholder small {
    font-size: 0.75em;
    word-break: break-all;
  }
  .missing {
    background: repeating-linear-gradient(45deg, var(--node-placeholder) 0 12px, transparent 12px 24px);
    border: 1px dashed var(--text-muted);
  }
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
  /* Sized in screen pixels: --inv-zoom undoes the camera's scale. */
  .badge,
  .bar {
    position: absolute;
    font-size: calc(12px * var(--inv-zoom));
    color: #fff;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* Which page, quietly, so a multi-page PDF reads as one. */
  .badge {
    right: 0.6em;
    bottom: 0.6em;
    padding: 0.2em 0.6em;
    border-radius: calc(0.8em * var(--round));
    background: rgb(20 20 24 / 0.55);
    pointer-events: none;
  }
  /* A floating pill like a video's bar, dark enough to read over any page. */
  .bar {
    left: 50%;
    bottom: 0.6em;
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: 0.2em;
    height: 2.4em;
    padding: 0 0.3em;
    border-radius: calc(0.9em * var(--round));
    background: rgb(20 20 24 / 0.72);
    border: 1px solid rgb(255 255 255 / 0.1);
    box-shadow: 0 0.3em 1.2em rgb(0 0 0 / 0.25);
  }
  .count {
    min-width: 3.6em;
    text-align: center;
  }
  button {
    display: grid;
    place-items: center;
    width: 1.9em;
    height: 1.9em;
    padding: 0;
    border: none;
    border-radius: calc(0.5em * var(--round));
    background: none;
    /* Hover changes color, not opacity (an opacity transition gets a compositing layer). */
    color: rgb(255 255 255 / 0.85);
    font: inherit;
    cursor: pointer;
    transition:
      color 100ms,
      background 100ms;
  }
  button :global(svg) {
    width: 1.25em;
    height: 1.25em;
  }
  button:hover:not(:disabled) {
    color: #fff;
    background: rgb(255 255 255 / 0.14);
  }
  button:disabled {
    color: rgb(255 255 255 / 0.3);
    cursor: default;
  }
</style>
