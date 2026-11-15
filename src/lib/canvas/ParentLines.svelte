<script lang="ts">
  import { camera, doc, selectedNodes, ui } from "../app.svelte";
  import type { CanvasNode } from "../doc/types";
  import { frames } from "../frame/frames.svelte";
  import { parentOf, parents } from "../parent/parents.svelte";
  import type { Interaction } from "./interaction.svelte";

  let { ix }: { ix: Interaction } = $props();

  // Faint dashed lines from children to their parent while either end is selected, center to
  // center, with a dot at the parent's end. Screen space (outside the camera layer), so nothing
  // under it gets its own compositing layer. Hidden while nodes are lifted by a drag.
  const pairs = $derived.by(() => {
    if (ix.lifting || ui.editing) return [];
    const out = new Map<string, [CanvasNode, CanvasNode]>();
    for (const n of selectedNodes()) {
      const p = parentOf(n);
      if (p) out.set(n.id, [n, p]);
      for (const id of parents.children.get(n.id) ?? []) out.set(id, [doc.nodes[id], n]);
    }
    return [...out.values()].filter(([c, p]) => !frames.hidden.has(c.id) && !frames.hidden.has(p.id));
  });

  const screen = (n: CanvasNode) => ({ x: (n.x + n.w / 2) * camera.zoom + camera.x, y: (n.y + n.h / 2) * camera.zoom + camera.y });
  const lines = $derived(pairs.map(([c, p]) => ({ id: c.id, a: screen(c), b: screen(p) })));
</script>

{#if lines.length}
  <svg class="parents" aria-hidden="true">
    {#each lines as l (l.id)}
      <line class="halo" x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} />
      <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} />
      <circle cx={l.b.x} cy={l.b.y} r="3.5" />
    {/each}
  </svg>
{/if}

<style>
  .parents {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  line {
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-dasharray: 5 4;
    stroke-linecap: round;
    opacity: 0.8;
  }
  line.halo {
    stroke: var(--canvas-bg);
    stroke-width: 4;
    stroke-dasharray: none;
    opacity: 0.6;
  }
  circle {
    fill: var(--accent);
    stroke: var(--canvas-bg);
    stroke-width: 1.5;
  }
</style>
