<script lang="ts">
  import { tip } from "../ui/tips.svelte";
  import { camera, selectedNodes, ui } from "../app.svelte";
  import { frameData } from "../frame/model";
  import { isFlow } from "./flow";
  import { slotOf } from "./slot";
  import { textData } from "../text/palette";
  import type { Interaction } from "./interaction.svelte";

  let { ix }: { ix: Interaction } = $props();

  const nodes = $derived(selectedNodes());
  // Hidden while editing text, and while nodes are lifted by a drag (it would fight the lean).
  // Frames aren't scaled or rotated: one expanded frame gets resize handles on every corner and
  // edge; otherwise no handles while a frame is selected (its outline shows it). Pins alone have
  // none: they're points, drawn selected by their marker.
  const frame = $derived(nodes.length === 1 && nodes[0].kind === "frame" && !frameData(nodes[0].data).collapsed);
  const box = $derived(ui.editing || ix.lifting || (!frame && nodes.some((n) => n.kind === "frame")) || nodes.every((n) => n.kind === "pin") ? null : ix.box);
  // Text and checklists: side handles change the width; the height follows the content.
  // (A table's width comes from its columns: no side handles.)
  const singleText = $derived(nodes.length === 1 && isFlow(nodes[0]) && nodes[0].kind !== "table");
  // A selection with a locked node can't be scaled or rotated: the box stays, without handles.
  const locked = $derived(nodes.some((n) => n.locked));
  const screen = $derived(
    box && {
      x: box.cx * camera.zoom + camera.x,
      y: box.cy * camera.zoom + camera.y,
      w: box.w * camera.zoom,
      h: box.h * camera.zoom,
    },
  );
  // Very small selections keep only the rotate handle and one corner so they stay clickable.
  const tiny = $derived(!!screen && Math.min(screen.w, screen.h) < 24);
  const corners = $derived(tiny ? ["se"] : ["nw", "ne", "se", "sw"]);
  const slot = $derived(nodes.length === 1 && !!slotOf(nodes[0]));
  const fixedText = $derived(nodes.length === 1 && nodes[0].kind === "text" && !!textData(nodes[0].data).fixed);
  const edges = $derived(frame || (slot && !tiny) || (fixedText && !tiny) ? ["n", "e", "s", "w"] : singleText && !tiny ? ["e", "w"] : []);
</script>

{#if box && screen}
  <div
    class="box"
    class:multi={nodes.length > 1}
    class:active={ix.activeHandle !== null}
    class:below={ix.rotateBelow}
    style:left="{screen.x}px"
    style:top="{screen.y}px"
    style:width="{screen.w}px"
    style:height="{screen.h}px"
    style:transform="translate(-50%, -50%) rotate({box.rotation}deg)"
  >
    {#if !locked}
      {#if !frame}
        <div class="stem"></div>
        <div class="handle rotate" data-handle="rotate" {@attach tip({ text: "Rotate", detail: "Shift snaps to 15°" })}></div>
      {/if}
      {#each corners as h (h)}
        <div class="handle corner {h}" data-handle={h} {@attach tip(frame || slot ? { text: "Resize", detail: "Alt skips the grid" } : { text: "Scale", detail: "Alt scales from the center" })}></div>
      {/each}
      {#each edges as h (h)}
        <div class="handle edge {h}" data-handle={h} {@attach tip(frame || slot ? { text: "Resize", detail: "Alt skips the grid" } : "Width")}></div>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .box {
    position: absolute;
    pointer-events: none;
    animation: appear 120ms ease-out;
  }
  .box.multi {
    outline: 1px dashed var(--accent);
    outline-offset: 4px;
  }
  .handle {
    position: absolute;
    pointer-events: auto;
    box-sizing: border-box;
    background: var(--handle-bg);
    border: 1.5px solid var(--accent);
    transition: scale 120ms ease;
  }
  .handle:hover {
    scale: 1.25;
  }
  .corner {
    width: 10px;
    height: 10px;
    border-radius: calc(2px * var(--round));
    margin: -5px;
  }
  .nw {
    left: 0;
    top: 0;
    cursor: nwse-resize;
  }
  .ne {
    right: 0;
    top: 0;
    cursor: nesw-resize;
  }
  .se {
    right: 0;
    bottom: 0;
    cursor: nwse-resize;
  }
  .sw {
    left: 0;
    bottom: 0;
    cursor: nesw-resize;
  }
  .multi .corner {
    margin: -9px;
  }
  .edge {
    border-radius: calc(3px * var(--round));
  }
  .e,
  .w {
    top: 50%;
    width: 6px;
    height: 18px;
    margin-top: -9px;
    cursor: ew-resize;
  }
  .n,
  .s {
    left: 50%;
    width: 18px;
    height: 6px;
    margin-left: -9px;
    cursor: ns-resize;
  }
  .e {
    right: -3px;
  }
  .w {
    left: -3px;
  }
  .n {
    top: -3px;
  }
  .s {
    bottom: -3px;
  }
  .rotate {
    left: 50%;
    top: -30px;
    width: 12px;
    height: 12px;
    margin-left: -6px;
    border-radius: 50%;
    cursor: grab;
  }
  /* Under the top chrome: the handle and its stem go below the selection. */
  .below .rotate {
    top: auto;
    bottom: -30px;
  }
  .below .stem {
    top: auto;
    bottom: -18px;
  }
  .active .rotate {
    cursor: grabbing;
  }
  .stem {
    position: absolute;
    left: 50%;
    top: -18px;
    height: 18px;
    width: 1px;
    background: var(--accent);
  }
  @keyframes appear {
    from {
      opacity: 0;
    }
  }
</style>
