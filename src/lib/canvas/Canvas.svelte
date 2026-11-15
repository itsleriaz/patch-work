<script lang="ts">
  import { onMount } from "svelte";
  import { camera, doc, fresh, importDropped, openPath, selection, ui, wiggles } from "../app.svelte";
  import { createText, startEdit, startLinkLabelEdit } from "../actions.svelte";
  import { checklistUi } from "../checklist/state.svelte";
  import { counterUi } from "../counter/count.svelte";
  import { pinUi } from "../pin/pins.svelte";
  import { drawUi, enterDraw } from "../drawing/draw.svelte";
  import { paletteUi } from "../palette/palette.svelte";
  import { enterMap, mapUi } from "../map/map.svelte";
  import { relinkMissing } from "../storage.svelte";
  import { backend } from "../backend";
  import { aabb, intersects, union } from "../doc/geometry";
  import { isPlayable, playing, togglePlaying } from "../media/playback.svelte";
  import { isSprite } from "../sprite/model";
  import { toggleSprite } from "../sprite/sprites.svelte";
  import { Interaction } from "./interaction.svelte";
  import { settings } from "../settings.svelte";
  import EdgeArrows from "./EdgeArrows.svelte";
  import { searchUi } from "../search/search.svelte";
  import Grid from "./Grid.svelte";
  import LinkHandles from "./LinkHandles.svelte";
  import LinkLayer from "./LinkLayer.svelte";
  import NodeView from "./NodeView.svelte";
  import { frames, frameUi, shownNode, syncFrames } from "../frame/frames.svelte";
  import SelectionBox from "./SelectionBox.svelte";
  import ParentLines from "./ParentLines.svelte";
  import TaskGhost from "./TaskGhost.svelte";
  import InkLayer from "./InkLayer.svelte";
  import PickerLayer from "./PickerLayer.svelte";

  let { interaction = $bindable() }: { interaction?: Interaction } = $props();

  const ix = new Interaction();
  interaction = ix;

  let viewport: HTMLDivElement;

  // Virtualization: only nodes near the viewport are in the DOM, so offscreen
  // images release their decoded bitmaps.
  const area = $derived.by(() => {
    const v = camera.viewRect;
    const m = Math.max(v.w, v.h) * 0.25;
    return { x: v.x - m, y: v.y - m, w: v.w + 2 * m, h: v.h + 2 * m };
  });
  // The node being edited stays mounted so panning away doesn't drop the editor; playing media
  // stays mounted so it keeps playing.
  // Members of collapsed frames aren't drawn at all.
  const visible = $derived(
    doc.nodeList.filter(
      // (and those shrinking into one right now)
      (n) => (!frames.hidden.has(n.id) || frameUi.tucking.has(n.id)) && (n.id === ui.editing?.id || playing.has(n.id) || intersects(area, aabb(n))),
    ),
  );
  // Frames fit their members (or stay a compact card when collapsed), on screen or not.
  $effect(() => syncFrames());
  // Links whose ends' bounds (plus room for the curve's bulge) reach the view.
  const visibleLinks = $derived(
    doc.linkList.filter((l) => {
      // A hidden end attaches to its collapsed frame; both ends in the same one hides the link.
      const a = shownNode(l.from), b = shownNode(l.to);
      if (!a || !b || a === b) return false;
      const r = union([aabb(a), aabb(b)])!;
      const pad = 240;
      return intersects(area, { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad });
    }),
  );


  // Empty canvas: new text. Text: edit. Counter, pin: rename. Video, audio: play or pause. Image: zoom to it.
  // Link: edit its label.
  function onDoubleClick(e: MouseEvent) {
    if (drawUi.active || paletteUi.picking || mapUi.editing) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-editor], [data-handle], [data-link-handle]")) return;
    const link = target.closest<SVGElement>("[data-link-id]")?.dataset.linkId;
    if (link) return startLinkLabelEdit(link);
    const id = target.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    const rect = viewport.getBoundingClientRect();
    if (!id) return createText(camera.toWorld(e.clientX - rect.left, e.clientY - rect.top));
    const node = doc.nodes[id];
    // A missing file: look for it.
    if (node && doc.assetOf(node)?.missing) return void relinkMissing();
    if (node?.kind === "text") startEdit(id);
    else if (node?.kind === "counter") counterUi.editing = { nodeId: id, field: "label" };
    else if (node?.kind === "pin") pinUi.editing = id;
    else if (node?.kind === "drawing") enterDraw(id);
    else if (node?.kind === "map") enterMap(id);
    else if (node?.kind === "checklist") {
      // Straight into the double-clicked task.
      const item = target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId ?? null;
      checklistUi.focus = { nodeId: id, itemId: item };
      startEdit(id);
    }
    else if (node && isPlayable(node)) togglePlaying(id);
    else if (node && isSprite(node)) toggleSprite(id);
    else if (node) camera.frame(aabb(node), { maxZoom: 8 });
  }

  onMount(() => {
    const rect = viewport.getBoundingClientRect();
    camera.set({ x: rect.width / 2, y: rect.height / 2, zoom: 1 });

    const onWheel = (e: WheelEvent) => ix.wheel(e, viewport);
    const onGesture = (e: Event) => ix.gesture(e, viewport);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
      viewport.addEventListener(type, onGesture, { passive: false });
    }
    const unlisten = backend.listenDrops({
      onHover: (over) => (ui.dropHover = over),
      onDrop: (x, y, result) => importDropped(x, y, result, viewport.getBoundingClientRect()),
      onOpen: (path) => void openPath(path),
      onError: (message) => ui.notify(`Import failed: ${message}`, "warn"),
    });

    return () => {
      viewport.removeEventListener("wheel", onWheel);
      for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
        viewport.removeEventListener(type, onGesture);
      }
      unlisten();
    };
  });
</script>

<div
  class="viewport"
  class:space={ix.spaceHeld}
  class:panning={ix.panning}
  class:draw={drawUi.active}
  class:picking={!!paletteUi.picking || !!mapUi.editing}
  bind:this={viewport}
  bind:clientWidth={camera.width}
  bind:clientHeight={camera.height}
  onpointerdown={(e) => ix.pointerDown(e, viewport)}
  onpointermove={(e) => {
    ui.pointer = { x: e.clientX, y: e.clientY };
    ix.pointerMove(e);
  }}
  onpointerleave={() => {
    ui.pointer = null;
    ix.leave();
  }}
  onpointerup={(e) => ix.pointerUp(e)}
  onpointercancel={() => ix.pointerUp()}
  ondblclick={onDoubleClick}
  oncontextmenu={(e) => ix.contextMenu(e, viewport)}
  role="application"
>
  <Grid />
  <div
    class="camera"
    class:moving={ix.cameraMoving || camera.gliding}
    style:transform="translate({camera.x}px, {camera.y}px) scale({camera.zoom})"
    style:--inv-zoom={1 / camera.zoom}
    style:--tilt="{ix.tilt}deg"
  >
    <LinkLayer links={visibleLinks} {ix} />
    {#each visible as node (node.id)}
      <NodeView
        {node}
        selected={selection.has(node.id)}
        fresh={fresh.get(node.id)}
        editing={ui.editing?.id === node.id}
        lifted={ix.lifting && ix.dragged.has(node.id)}
        tuck={frameUi.tucking.get(node.id)}
        linkTarget={ix.linkDraft?.target === node.id}
        wiggle={wiggles.get(node.id)}
        highlighted={ui.highlight.has(node.id)}
        found={searchUi.hits.has(node.id)}
        hovered={ix.hoverId === node.id}
      />
    {/each}
  </div>

  <ParentLines {ix} />
  <SelectionBox {ix} />
  <EdgeArrows />
  <LinkHandles {ix} />
  <TaskGhost />
  {#if drawUi.active}<InkLayer {ix} />{/if}
  {#if paletteUi.picking}<PickerLayer />{/if}

  {#if ix.marquee}
    <div
      class="marquee"
      style:left="{ix.marquee.x}px"
      style:top="{ix.marquee.y}px"
      style:width="{ix.marquee.w}px"
      style:height="{ix.marquee.h}px"
    ></div>
  {/if}

  {#if doc.nodeList.length === 0 && !ui.dropHover}
    <div class="empty">
      <p>Drop files here</p>
      <small>images, video, audio, .md and .txt files, or whole folders</small>
    </div>
  {/if}

  {#if ui.dropHover}
    <div class="drop-hint"><span>Drop to add</span></div>
  {/if}
</div>

<style>
  .viewport {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background-color: var(--canvas-bg);
    cursor: default;
    touch-action: none;
  }
  .viewport.space {
    cursor: grab;
  }
  .viewport.panning {
    cursor: grabbing;
  }
  /* Draw mode: the brush outline is the cursor, and nothing on the board takes the pointer. */
  .viewport.draw:not(.space):not(.panning) {
    cursor: none;
  }
  .viewport.draw .camera,
  .viewport.picking .camera {
    pointer-events: none;
  }
  /* The eyedropper: a crosshair, and the magnifier beside it. */
  .viewport.picking:not(.space):not(.panning) {
    cursor: crosshair;
  }
  .camera {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
  }
  /* Promote to a GPU layer only while moving: panning becomes pure compositing,
     and contents re-rasterize sharply once the camera settles. */
  .camera.moving {
    will-change: transform;
  }
  .marquee {
    position: absolute;
    border: 1px solid var(--accent);
    background: var(--accent-wash);
    pointer-events: none;
    border-radius: calc(2px * var(--round));
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    text-align: center;
    color: var(--text-muted);
    pointer-events: none;
  }
  .empty p {
    margin: 0;
    font-size: 20px;
    font-weight: 500;
  }
  .empty small {
    opacity: 0.7;
  }
  .drop-hint {
    position: absolute;
    inset: 12px;
    border: 2px dashed var(--accent);
    border-radius: calc(16px * var(--round));
    background: var(--accent-wash);
    display: grid;
    place-items: center;
    pointer-events: none;
    animation: breathe 1.2s ease-in-out infinite alternate;
  }
  .drop-hint span {
    color: var(--accent);
    font-size: 18px;
    font-weight: 600;
  }
  @keyframes breathe {
    to {
      inset: 20px;
    }
  }
</style>
