<script lang="ts">
  import { tip } from "../ui/tips.svelte";
  import { camera, doc, linkSelection, selectedNodes, selection, ui } from "../app.svelte";
  import { checklistUi } from "../checklist/state.svelte";
  import type { Point } from "../doc/geometry";
  import type { CanvasNode, LinkSide } from "../doc/types";
  import { shown, shownNode } from "../frame/frames.svelte";
  import { linkPath, sideDot } from "../links/geometry";
  import { linkData, linkSides } from "../links/palette";
  import { LINK_DOT_GAP, type Interaction } from "./interaction.svelte";

  let { ix }: { ix: Interaction } = $props();

  const toScreen = (p: Point) => ({ x: p.x * camera.zoom + camera.x, y: p.y * camera.zoom + camera.y });
  const dotsOf = (node: CanvasNode, sides: LinkSide[]) =>
    sides.map((side) => ({ side, ...toScreen(sideDot(node, side, LINK_DOT_GAP / camera.zoom)) }));
  const big = (node: CanvasNode) => Math.min(node.w, node.h) * camera.zoom >= 24;
  const quiet = $derived(ix.spaceHeld || !!ui.editing || !!ui.editingLink || !!ui.menu || !!checklistUi.drag);

  // Hovering a node: one handle per side to drag a link out of. Any of them works (the new link
  // leaves from the side facing its other end). A selected node skips the side its rotate handle
  // is on: the top, or the bottom when the handle had to go there (frames have none).
  // A pin by its marker's head.
  const hovered = $derived(ix.hoverId && doc.nodes[ix.hoverId] ? shown(doc.nodes[ix.hoverId]) : undefined);
  const dots = $derived.by(() => {
    if (!hovered || ix.busy || quiet || !big(hovered)) return [];
    const selected = selection.has(hovered.id);
    const rotatable = selected && hovered.kind !== "frame" && hovered.kind !== "pin" && !selectedNodes().some((n) => n.locked);
    // A selected table has its "+" bars on the right and at the bottom.
    const bars = selected && hovered.kind === "table";
    const sides = (["right", "bottom", "left", "top"] as LinkSide[]).filter(
      (s) => !(s === (ix.rotateBelow ? "bottom" : "top") && rotatable) && !(bars && (s === "right" || s === "bottom")),
    );
    return dotsOf(hovered, sides);
  });

  // Dragging a link over a node: its side dots, to pin the end to one; the snapped one lights up.
  const target = $derived(ix.linkDraft?.target ? shownNode(ix.linkDraft.target) : undefined);
  const targetDots = $derived(target && big(target) ? dotsOf(target, ["top", "right", "bottom", "left"]) : []);

  // Selected links: a handle on each end, to reconnect it.
  const ends = $derived.by(() => {
    if (ix.busy || quiet) return [];
    return [...linkSelection.values()].slice(0, 24).flatMap((id) => {
      const l = doc.links[id];
      // An end hidden in a collapsed frame is drawn at the frame.
      const a = l && shownNode(l.from), b = l && shownNode(l.to);
      if (!l || !a || !b || a === b) return [];
      const path = linkPath(a, b, linkData(l.data).shape, linkSides(l.data));
      return [
        { key: `${id}:from`, ...toScreen(path.from.p) },
        { key: `${id}:to`, ...toScreen(path.to.p) },
      ];
    });
  });
</script>

{#each dots as dot (dot.side)}
  <div
    class="dot"
    data-link-handle={hovered!.id}
    {@attach tip({ text: "Drag to link", detail: "Drop on empty canvas for a new card" })}
    style:left="{dot.x}px"
    style:top="{dot.y}px"
  ></div>
{/each}

{#each targetDots as dot (dot.side)}
  <div class="dot target" class:snapped={ix.linkDraft?.side === dot.side} style:left="{dot.x}px" style:top="{dot.y}px"></div>
{/each}

{#each ends as end (end.key)}
  <div class="end" data-link-end={end.key} {@attach tip("Drag to reconnect")} style:left="{end.x}px" style:top="{end.y}px"></div>
{/each}

<style>
  .dot {
    position: absolute;
    width: 12px;
    height: 12px;
    margin: -6px;
    border-radius: 50%;
    box-sizing: border-box;
    background: var(--panel-solid);
    border: 2px solid var(--accent);
    cursor: crosshair;
    animation: dot-in 140ms cubic-bezier(0.34, 1.56, 0.64, 1);
    transition: scale 100ms ease;
  }
  .dot:hover {
    scale: 1.35;
    background: var(--accent);
  }
  /* A drop target's side dots: drop on one to pin that side. */
  .dot.target {
    pointer-events: none;
    opacity: 0.75;
  }
  .dot.target.snapped {
    opacity: 1;
    scale: 1.5;
    background: var(--accent);
  }
  /* A selected link's ends, to reconnect. */
  .end {
    position: absolute;
    width: 14px;
    height: 14px;
    margin: -7px;
    border-radius: 50%;
    box-sizing: border-box;
    background: var(--accent);
    border: 2px solid var(--handle-bg);
    box-shadow: 0 1px 4px var(--panel-shadow);
    cursor: grab;
    animation: dot-in 140ms cubic-bezier(0.34, 1.56, 0.64, 1);
    transition: scale 100ms ease;
  }
  .end:hover {
    scale: 1.25;
  }
  @keyframes dot-in {
    from {
      scale: 0.3;
      opacity: 0;
    }
  }
  :global(:root[data-calm]) .dot,
  :global(:root[data-calm]) .end {
    animation: none;
  }
</style>
