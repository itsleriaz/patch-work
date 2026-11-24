<script lang="ts">
  import { Lock } from "@lucide/svelte";
  import { cubicIn } from "svelte/easing";
  import { camera, doc } from "../app.svelte";
  import type { CanvasNode, MediaData } from "../doc/types";
  import { settings } from "../settings.svelte";
  import AudioContent from "./AudioContent.svelte";
  import ImageContent from "./ImageContent.svelte";
  import PdfContent from "./PdfContent.svelte";
  import SpriteContent from "./SpriteContent.svelte";
  import TimerContent from "./TimerContent.svelte";
  import PaletteContent from "./PaletteContent.svelte";
  import MapContent from "./MapContent.svelte";
  import ChecklistContent from "./ChecklistContent.svelte";
  import DrawingContent from "./DrawingContent.svelte";
  import CounterContent from "./CounterContent.svelte";
  import FrameContent from "./FrameContent.svelte";
  import PinContent from "./PinContent.svelte";
  import TableContent from "./TableContent.svelte";
  import TextContent from "./TextContent.svelte";
  import VideoContent from "./VideoContent.svelte";

  let {
    node,
    selected,
    fresh,
    editing,
    lifted,
    tuck,
    linkTarget = false,
    wiggle,
    highlighted = false,
    found = false,
    hovered = false,
  }: {
    node: CanvasNode;
    selected: boolean;
    /** Pop-in delay in ms while the node is newly created. */
    fresh: number | undefined;
    editing: boolean;
    /** Picked up by a drag. */
    lifted: boolean;
    /** Shrinking into a collapsed frame: the offset to the frame card's middle (node frame). */
    tuck?: { dx: number; dy: number };
    /** Where a link being dragged would connect. */
    linkTarget?: boolean;
    /** Changed by undo/redo just now: a token, whose parity picks the animation so a new one restarts it. */
    wiggle?: number;
    /** Pointed out from outside the canvas (hovering a history entry). */
    highlighted?: boolean;
    /** Has a search match (a faint ring; the current match is `highlighted`). */
    found?: boolean;
    /** Under the pointer (a locked node shows its badge). */
    hovered?: boolean;
  } = $props();

  /** Frames go under every node and under the links layer (-2147483647 + 1). */
  const FRAME_Z = -2147483647;
  /** Pins are markers: always on top. */
  const PIN_Z = 2147483000;

  const asset = $derived(doc.assetOf(node));
  /** Pictures: square corners and a drop shadow. */
  const media = $derived(node.kind === "image" || node.kind === "gif" || node.kind === "video" || node.kind === "pdf");
  const flip = $derived((node.data ?? {}) as MediaData);
  // Big nodes lean less: their corners would swing a long way.
  const lean = $derived(lifted ? Math.min(1, 320 / (Math.max(node.w, node.h) * camera.zoom)) : null);

  // Shrinks away when the node leaves the document; leaving the viewport (virtualization) is instant.
  function vanish(_el: Element, { id }: { id: string }) {
    if (settings.calm || doc.nodes[id]) return { duration: 0 };
    return { duration: 160, easing: cubicIn, css: (t: number) => `scale: ${0.75 + 0.25 * t}; opacity: ${t}` };
  }
</script>

<div
  class="node"
  class:selected
  class:editing
  class:lifted
  class:tucking={!!tuck}
  style:--tuck-x={tuck ? `${tuck.dx}px` : null}
  style:--tuck-y={tuck ? `${tuck.dy}px` : null}
  class:frame={node.kind === "frame"}
  class:pin={node.kind === "pin"}
  class:drawing={node.kind === "drawing"}
  class:link-target={linkTarget}
  class:highlighted
  class:found={found && !highlighted}
  data-node-id={node.id}
  style:transform="translate({node.x}px, {node.y}px) rotate({node.rotation}deg)"
  style:width="{node.w}px"
  style:height="{node.h}px"
  style:z-index={node.kind === "frame" ? FRAME_Z : node.kind === "pin" ? PIN_Z : node.z}
  style:--lean={lean}
>
  <!-- Its own box, so the wiggle doesn't fight the content's pop and select animations. -->
  <div class="wiggle" style:animation-name={wiggle === undefined ? null : wiggle % 2 ? "wiggle-a" : "wiggle-b"}>
  <div
    class="content"
    class:media
    class:pop={fresh !== undefined}
    style:animation-delay={fresh ? `${fresh}ms` : null}
    out:vanish={{ id: node.id }}
  >
    {#if node.kind === "video" && asset}
      <!-- Flips only the picture, not its controls. -->
      <VideoContent {node} {asset} />
    {:else if node.kind === "audio" && asset}
      <AudioContent {node} {asset} />
    {:else if node.kind === "sprite" && asset}
      <SpriteContent {node} {asset} />
    {:else if node.kind === "pdf" && asset}
      <PdfContent {node} {asset} {selected} />
    {:else if media && asset}
      <div class="flip" style:transform="scale({flip.flipX ? -1 : 1}, {flip.flipY ? -1 : 1})">
        <ImageContent {node} {asset} />
      </div>
    {:else if node.kind === "drawing"}
      <DrawingContent {node} />
    {:else if node.kind === "text"}
      <TextContent {node} {editing} />
    {:else if node.kind === "checklist"}
      <ChecklistContent {node} {editing} />
    {:else if node.kind === "timer"}
      <TimerContent {node} />
    {:else if node.kind === "counter"}
      <CounterContent {node} />
    {:else if node.kind === "palette"}
      <PaletteContent {node} />
    {:else if node.kind === "map"}
      <MapContent {node} />
    {:else if node.kind === "frame"}
      <FrameContent {node} />
    {:else if node.kind === "table"}
      <TableContent {node} />
    {:else if node.kind === "pin"}
      <PinContent {node} {selected} target={linkTarget} />
    {/if}
  </div>
  </div>
  {#if node.locked && (selected || hovered) && node.kind !== "pin"}
    <div class="lock" aria-hidden="true"><Lock /></div>
  {/if}
</div>

<style>
  /* Constant screen size in the top-right corner; paint-only (no animation, see HANDOFF §8). */
  .lock {
    position: absolute;
    top: calc(6px * var(--inv-zoom));
    right: calc(6px * var(--inv-zoom));
    width: calc(22px * var(--inv-zoom));
    height: calc(22px * var(--inv-zoom));
    padding: calc(4px * var(--inv-zoom));
    box-sizing: border-box;
    border-radius: calc(6px * var(--round) * var(--inv-zoom));
    background: var(--panel-solid);
    color: var(--text);
    box-shadow: 0 calc(1px * var(--inv-zoom)) calc(4px * var(--inv-zoom)) var(--panel-shadow);
    pointer-events: none;
  }
  .lock :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .node {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 50% 50%;
  }
  .wiggle {
    width: 100%;
    height: 100%;
    animation-duration: 420ms;
    animation-timing-function: ease-out;
  }
  /* Two identical animations: switching between them restarts the wiggle. */
  @keyframes wiggle-a {
    20% { rotate: -2.5deg; scale: 1.03; }
    45% { rotate: 2deg; }
    70% { rotate: -1deg; }
  }
  @keyframes wiggle-b {
    20% { rotate: -2.5deg; scale: 1.03; }
    45% { rotate: 2deg; }
    70% { rotate: -1deg; }
  }
  /* Pointed out from the history panel: a pulsing ring of constant screen size. It pulses its
     color, not its opacity: an endless opacity animation gets its own compositing layer, which
     would blur the nodes above it when zooming (HANDOFF §8). */
  .highlighted::after {
    content: "";
    position: absolute;
    inset: calc(-6px * var(--inv-zoom));
    border: calc(2px * var(--inv-zoom)) solid var(--accent);
    border-radius: calc(10px * var(--round) * var(--inv-zoom));
    pointer-events: none;
    animation: point-out 1s ease-in-out infinite alternate;
  }
  /* Other search matches: a faint, still ring. */
  .found::after {
    content: "";
    position: absolute;
    inset: calc(-5px * var(--inv-zoom));
    border: calc(1.5px * var(--inv-zoom)) dashed color-mix(in srgb, var(--accent) 55%, transparent);
    border-radius: calc(10px * var(--round) * var(--inv-zoom));
    pointer-events: none;
  }
  @keyframes point-out {
    from { border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
  }
  .content {
    width: 100%;
    height: 100%;
    border-radius: calc(0.45em * var(--round));
    /* Springs back when dropped. */
    transition:
      scale 280ms cubic-bezier(0.34, 1.56, 0.64, 1),
      rotate 180ms ease-out,
      box-shadow 200ms ease-out;
  }
  /* While the camera moves, --inv-zoom steps (Canvas.svelte): a shadow drawn with it jumps instead
     of easing, or every picture's shadow would be repainted on every frame of a zoom. */
  :global(:where(.camera.moving)) .content {
    transition:
      scale 280ms cubic-bezier(0.34, 1.56, 0.64, 1),
      rotate 180ms ease-out;
  }
  /* Picked up: grows a little and leans with the drag. No transition on the position: one that
     restarts on every move (or every grid cell crossed) trails the pointer and stutters. */
  .lifted {
    transition: none;
  }
  /* Frames sit under everything (below links too) and let clicks through, except their title bar. */
  .frame {
    pointer-events: none;
  }
  .frame .content {
    border-radius: calc(14px * var(--round));
  }
  .frame.lifted .content {
    scale: none;
    rotate: none;
  }
  /* A drawing takes the pointer only on its strokes (DrawingContent), so pictures under it stay
     clickable; once selected, its whole box can be grabbed. */
  .drawing:not(.selected) {
    pointer-events: none;
  }
  /* A pin draws its own selection and highlight; its box is a point. */
  .pin .content {
    outline: none !important;
  }
  /* Dropped into a collapsed frame: it shrinks into the card. */
  .tucking .content {
    translate: var(--tuck-x) var(--tuck-y);
    scale: 0.12;
    opacity: 0;
    transition:
      translate 240ms cubic-bezier(0.5, 0, 0.9, 0.6),
      scale 240ms cubic-bezier(0.5, 0, 0.9, 0.6),
      opacity 240ms ease-in;
  }
  .lifted .content {
    scale: 1.03;
    rotate: calc(var(--tilt, 0deg) * var(--lean, 1));
  }
  .lifted .content.media {
    box-shadow: 0 calc(14px * var(--shadow-zoom)) calc(36px * var(--shadow-zoom)) var(--node-shadow);
  }
  .content.media {
    border-radius: 0;
    box-shadow: 0 calc(4px * var(--shadow-zoom)) calc(18px * var(--shadow-zoom)) var(--node-shadow);
  }
  .flip {
    width: 100%;
    height: 100%;
  }
  /* Outline width is divided by zoom so it stays a constant 2 screen px. */
  .selected .content {
    outline: calc(2px * var(--inv-zoom)) solid var(--accent);
    outline-offset: calc(1px * var(--inv-zoom));
  }
  /* The outline snaps inward when selected. */
  .selected .content {
    animation: select-in 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .editing .content {
    outline-style: dashed;
  }
  .link-target .content {
    outline: calc(2px * var(--inv-zoom)) dashed var(--accent);
    outline-offset: calc(4px * var(--inv-zoom));
  }
  .pop {
    animation: pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
  }
  /* Both listed, so select-in is matched by name and doesn't replay when .pop goes away. */
  .selected .content.pop {
    animation:
      pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards,
      select-in 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes pop {
    from {
      scale: 0.6;
      opacity: 0;
    }
  }
  @keyframes select-in {
    from {
      outline-offset: calc(7px * var(--inv-zoom));
      outline-color: transparent;
    }
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }

  /* Calm mode: no lift, lean or bounce; new nodes simply fade in. */
  :global(:root[data-calm]) .lifted,
  :global(:root[data-calm]) .content {
    transition: none;
  }
  :global(:root[data-calm]) .lifted .content {
    scale: none;
    rotate: none;
  }
  :global(:root[data-calm]) .selected .content {
    animation: none;
  }
  :global(:root[data-calm]) .pop,
  :global(:root[data-calm]) .selected .content.pop {
    animation: fade-in 160ms ease-out backwards;
  }
</style>
