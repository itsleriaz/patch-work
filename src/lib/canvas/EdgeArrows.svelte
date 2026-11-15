<script lang="ts">
  import { ArrowRight } from "@lucide/svelte";
  import { camera, ui } from "../app.svelte";
  import { shownNode } from "../frame/frames.svelte";
  import { inView } from "../outline/outline.svelte";

  /**
   * Nodes pointed out from a panel (hovering an outline or history row) that are off-screen get
   * an arrow at the edge of the view, pointing towards them. Screen space, outside the camera.
   */

  /** Distance from the view's edges, CSS px. */
  const MARGIN = 28;
  const MAX_ARROWS = 6;

  const arrows = $derived.by(() => {
    const w = camera.width - camera.insetRight, h = camera.height;
    const cx = w / 2, cy = h / 2;
    const out: { id: string; x: number; y: number; angle: number }[] = [];
    for (const id of ui.highlight) {
      // A node hidden in a collapsed frame is pointed at through the frame.
      const n = shownNode(id);
      if (!n || inView(n) || out.length >= MAX_ARROWS) continue;
      const tx = (n.x + n.w / 2) * camera.zoom + camera.x, ty = (n.y + n.h / 2) * camera.zoom + camera.y;
      const dx = tx - cx, dy = ty - cy;
      // Walk from the middle towards the node until the margin box.
      const sx = dx ? (dx > 0 ? w - MARGIN - cx : MARGIN - cx) / dx : Infinity;
      const sy = dy ? (dy > 0 ? h - MARGIN - cy : MARGIN - cy) / dy : Infinity;
      const s = Math.min(sx, sy);
      out.push({ id, x: cx + dx * s, y: cy + dy * s, angle: Math.atan2(dy, dx) });
    }
    return out;
  });
</script>

{#each arrows as a (a.id)}
  <div class="arrow" style:left="{a.x}px" style:top="{a.y}px" style:rotate="{a.angle}rad">
    <ArrowRight size={16} strokeWidth={2.4} />
  </div>
{/each}

<style>
  .arrow {
    position: absolute;
    width: 30px;
    height: 30px;
    margin: -15px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
    box-shadow: 0 4px 14px var(--panel-shadow);
    pointer-events: none;
    z-index: 70;
    /* Pulses its color, not its opacity or size (no compositing layer of its own). */
    animation: beckon 0.9s ease-in-out infinite alternate;
  }
  @keyframes beckon {
    from {
      background: color-mix(in srgb, var(--accent) 60%, var(--canvas-bg));
    }
  }
</style>
