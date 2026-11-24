<script lang="ts">
  import { fitSize } from "./flow";
  import { tip } from "../ui/tips.svelte";
  import { Pipette, Plus } from "@lucide/svelte";
  import { camera, selection, ui } from "../app.svelte";
  import type { CanvasNode } from "../doc/types";
  import { luminance, paletteData } from "../palette/model";
  import { copyColor, editColor, moveColor, paletteUi, renamePalette, startPicking, stopPicking } from "../palette/palette.svelte";

  let { node }: { node: CanvasNode } = $props();

  const d = $derived(paletteData(node.data));
  const picking = $derived(paletteUi.picking === node.id);
  const renaming = $derived(paletteUi.renaming === node.id);

  let box: HTMLDivElement;

  // Height follows the content, like other flowing cards.
  $effect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize[0]?.blockSize ?? box.offsetHeight;
      if (h > 0 && Math.abs(h - node.h) > 0.5) fitSize(node, node.w, h);
    });
    observer.observe(box);
    return () => observer.disconnect();
  });

  /** A swatch just copied or added flashes; the parity picks the animation so a new flash restarts it. */
  const flashOf = (colorId: string) => (paletteUi.flash?.key === `${node.id}:${colorId}` ? paletteUi.flash.n : null);

  function menu(e: MouseEvent, colorId: string) {
    e.preventDefault();
    e.stopPropagation();
    paletteUi.swatch = { nodeId: node.id, colorId };
    const v = document.querySelector(".viewport")?.getBoundingClientRect();
    ui.menu = { x: e.clientX, y: e.clientY, world: camera.toWorld(e.clientX - (v?.left ?? 0), e.clientY - (v?.top ?? 0)), target: "swatch" };
  }

  /** A selected palette's swatches belong to it: dragging one reorders, double-clicking edits. */
  const selected = $derived(selection.has(node.id) && selection.size === 1);

  /** The swatch being dragged and where it would land; the strip shows that order meanwhile. */
  let dragging = $state<{ id: string; to: number } | null>(null);
  /** A drag just ended: the click that follows isn't a copy. */
  let dragged = false;
  const shownColors = $derived.by(() => {
    if (!dragging) return d.colors;
    const from = d.colors.findIndex((c) => c.id === dragging!.id);
    const next = [...d.colors];
    next.splice(dragging.to, 0, ...next.splice(from, 1));
    return next;
  });

  function pressSwatch(e: PointerEvent, colorId: string) {
    if (!selected || e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const sx = e.clientX, sy = e.clientY;
    dragged = false;
    const move = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        // Captured only once it moves (a press alone keeps its click; HANDOFF §8).
        try {
          el.setPointerCapture(ev.pointerId);
        } catch {
          // the pointer went away meanwhile; the window's listeners still follow it
        }
        dragging = { id: colorId, to: d.colors.findIndex((c) => c.id === colorId) };
      }
      // It lands in the place of the swatch nearest the pointer.
      let best = dragging.to, dist = Infinity;
      box.querySelectorAll<HTMLElement>("[data-swatch-id]").forEach((s, i) => {
        const r = s.getBoundingClientRect();
        const dd = Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2));
        if (dd < dist) (dist = dd), (best = i);
      });
      dragging = { id: colorId, to: best };
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!dragging) return;
      dragged = true;
      const to = dragging.to;
      dragging = null;
      moveColor(node.id, colorId, to);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function clickSwatch(e: MouseEvent, colorId: string, hex: string) {
    if (dragged) return void (dragged = false);
    if (e.detail > 1) return; // the second click of a double-click edits instead
    copyColor(hex, "hex", { nodeId: node.id, colorId });
  }

  function finishRename(input: HTMLInputElement, keep: boolean) {
    if (paletteUi.renaming !== node.id) return;
    paletteUi.renaming = null;
    if (keep) renamePalette(node.id, input.value);
  }

  function focus(el: HTMLInputElement) {
    el.focus();
    el.select();
  }
</script>

{#snippet addTile()}
  <button class="swatch add" data-editor aria-label="Add color" {@attach tip("Add a color by hand")} onclick={(e) => editColor(node.id, null, e.currentTarget.getBoundingClientRect())}>
    <span class="chip"><Plus size={16} strokeWidth={2} /></span>
    <span class="hex">Add</span>
  </button>
{/snippet}

<div class="palette" bind:this={box} style:font-size="{d.fontSize}px">
  <div class="head">
    {#if renaming}
      <input
        class="title-edit"
        data-editor
        value={d.title}
        placeholder="Palette"
        spellcheck="false"
        {@attach focus}
        onkeydown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") finishRename(e.currentTarget, true);
          if (e.key === "Escape") finishRename(e.currentTarget, false);
        }}
        onblur={(e) => finishRename(e.currentTarget, true)}
      />
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="title" class:placeholder={!d.title} ondblclick={(e) => (e.stopPropagation(), (paletteUi.renaming = node.id))}>{d.title || "Palette"}</span>
    {/if}
    <button
      class="dropper"
      class:on={picking}
      aria-label="Eyedropper"
      aria-pressed={picking}
      {@attach tip({ text: picking ? "Stop picking colors" : "Pick colors from pictures", keys: "I" })}
      onpointerdown={(e) => e.stopPropagation()}
      onclick={() => (picking ? stopPicking() : startPicking(node.id))}
    >
      <Pipette size={14} strokeWidth={2} />
    </button>
  </div>

  {#if d.colors.length}
    <div class="swatches">
      {#each shownColors as c (c.id)}
        {@const flash = flashOf(c.id)}
        <button
          class="swatch"
          class:lifted={dragging?.id === c.id}
          data-swatch-id={c.id}
          data-editor={selected ? "" : undefined}
          style:--c={c.hex}
          style:animation-name={flash === null ? null : flash % 2 ? "flash-a" : "flash-b"}
          class:light={luminance(c.hex) > 0.8}
          aria-label="Copy {c.hex}"
          {@attach tip(selected ? `Copy ${c.hex} · double-click to edit, drag to move` : `Copy ${c.hex} · right-click for more`)}
          onpointerdown={(e) => pressSwatch(e, c.id)}
          onclick={(e) => clickSwatch(e, c.id, c.hex)}
          ondblclick={(e) => (e.stopPropagation(), editColor(node.id, c.id, e.currentTarget.getBoundingClientRect()))}
          oncontextmenu={(e) => menu(e, c.id)}
        >
          <span class="chip"></span>
          <span class="hex">{c.hex}</span>
        </button>
      {/each}
      {#if selected}{@render addTile()}{/if}
    </div>
  {:else}
    <p class="empty">{picking ? "Click a picture to add its color." : "Use the eyedropper to add colors from pictures, or paste hex codes."}</p>
    {#if selected && !picking}<div class="swatches">{@render addTile()}</div>{/if}
  {/if}
</div>

<style>
  .palette {
    box-sizing: border-box;
    width: 100%;
    padding: 0.6em 0.75em 0.75em;
    border-radius: calc(0.7em * var(--round));
    background: var(--panel-solid);
    color: var(--text);
    box-shadow: 0 calc(3px * var(--shadow-zoom)) calc(14px * var(--shadow-zoom)) var(--node-shadow);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5em;
    margin-bottom: 0.55em;
    min-height: 1.6em;
  }
  .title,
  .title-edit {
    flex: 1;
    min-width: 0;
    font-size: 0.9em;
    font-weight: 600;
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .placeholder {
    color: var(--text-muted);
    font-weight: 500;
  }
  .title-edit {
    all: unset;
    flex: 1;
    font-size: 0.9em;
    font-weight: 600;
    border-bottom: 1px solid var(--accent);
    user-select: text;
    -webkit-user-select: text;
  }
  button {
    font: inherit;
    border: none;
    padding: 0;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .dropper {
    flex: none;
    display: grid;
    place-items: center;
    width: 1.7em;
    height: 1.7em;
    border-radius: calc(0.45em * var(--round));
    color: var(--text-muted);
    transition:
      background 100ms,
      color 100ms;
  }
  .dropper :global(svg) {
    width: 0.95em;
    height: 0.95em;
  }
  .dropper:hover {
    background: var(--panel-hover);
    color: var(--text);
  }
  .dropper.on {
    background: var(--accent);
    color: var(--on-accent);
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55em 0.5em;
  }
  .swatch {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.3em;
    width: 4.3em;
    border-radius: calc(0.45em * var(--round));
    animation-duration: 600ms;
    animation-timing-function: ease-out;
  }
  .chip {
    height: 3.1em;
    border-radius: calc(0.45em * var(--round));
    background: var(--c);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08);
    transition: box-shadow 120ms;
  }
  /* A near-white chip needs an edge on a light card. */
  .swatch.light .chip {
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.18);
  }
  .swatch:hover .chip {
    box-shadow:
      inset 0 0 0 1px rgb(0 0 0 / 0.08),
      0 0 0 0.15em var(--panel-solid),
      0 0 0 0.28em var(--c);
  }
  /* Being dragged: a ring in the accent (paint-only, §8). */
  .swatch.lifted .chip {
    box-shadow:
      0 0 0 0.15em var(--panel-solid),
      0 0 0 0.32em var(--accent);
  }
  .swatch.add .chip {
    display: grid;
    place-items: center;
    background: none;
    box-shadow: inset 0 0 0 1.5px var(--panel-border);
    color: var(--text-muted);
  }
  .swatch.add .chip :global(svg) {
    width: 1em;
    height: 1em;
  }
  .swatch.add:hover .chip {
    box-shadow: inset 0 0 0 1.5px var(--accent);
    color: var(--accent);
  }
  .hex {
    font-family: ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", monospace;
    font-size: 0.68em;
    letter-spacing: 0.02em;
    text-align: center;
    color: var(--text-muted);
  }
  .swatch:hover .hex {
    color: var(--text);
  }
  /* Copied or added: a ring that fades (box-shadow is paint-only; no opacity or transform, §8). */
  @keyframes flash-a {
    from { box-shadow: 0 0 0 0.3em var(--accent); }
    to { box-shadow: 0 0 0 0.3em transparent; }
  }
  @keyframes flash-b {
    from { box-shadow: 0 0 0 0.3em var(--accent); }
    to { box-shadow: 0 0 0 0.3em transparent; }
  }
  .empty {
    margin: 0.2em 0 0.1em;
    font-size: 0.8em;
    color: var(--text-muted);
  }
</style>
