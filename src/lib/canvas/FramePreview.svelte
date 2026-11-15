<script lang="ts">
  import { doc } from "../app.svelte";
  import { backend } from "../backend";
  import { aabb, union } from "../doc/geometry";
  import type { Asset, CanvasNode } from "../doc/types";
  import { drawingData, inkColor, MARKER_OPACITY, strokePath } from "../drawing/model";
  import { nodeFill } from "./fill";
  import { FRAME_COLORS, frameData } from "../frame/model";

  /**
   * A collapsed frame's preview: its members laid out as they are, in stacking order. Pictures show
   * their smallest level (videos their poster), drawings their strokes, everything else a box in its
   * color. One SVG (paint-only), letterboxed in the card. Also previews a whole recovery copy
   * (RecoveryReview), whose pictures come from its own assets: `assetOf`.
   */
  let {
    members,
    assetOf = (n: CanvasNode) => doc.assetOf(n),
    labels = false,
  }: { members: CanvasNode[]; assetOf?: (n: CanvasNode) => Asset | undefined; labels?: boolean } = $props();

  /** With `labels` (the recovery preview, large enough to read): a card's first line, a title. */
  function labelOf(n: CanvasNode): string {
    const d = (n.data ?? {}) as { md?: string; title?: string; label?: string };
    const raw = n.kind === "text" ? ((d.md ?? "").split("\n").find((l) => l.trim()) ?? "") : (d.title ?? d.label ?? "");
    // Markdown marks and task boxes left out: the words are what tell boards apart.
    return raw.replace(/^\s*(#+|[-*+]|\d+[.)])\s+/, "").replace(/^\[[ xX]\]\s+/, "").replace(/[*_`~]/g, "").trim();
  }

  const box = $derived(union(members.map(aabb)));
  // Frames (only in a whole board's preview) go under everything, as on the board.
  const depth = (n: CanvasNode) => (n.kind === "frame" ? -Infinity : n.z);
  const sorted = $derived([...members].sort((a, b) => depth(a) - depth(b) || a.z - b.z).filter((n) => n.kind !== "pin"));

  function picture(n: CanvasNode): string | null {
    const a = assetOf(n);
    if (!a || a.missing) return null;
    if (n.kind === "image" || n.kind === "gif") return backend.assetUrl(a, 256);
    if (n.kind === "video") return backend.posterUrl(a);
    return null;
  }
  const turn = (n: CanvasNode) => (n.rotation ? `rotate(${n.rotation} ${n.x + n.w / 2} ${n.y + n.h / 2})` : undefined);
</script>

{#if box}
  <svg viewBox="{box.x} {box.y} {box.w} {box.h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    {#each sorted as n (n.id)}
      {@const src = picture(n)}
      {#if src}
        <image href={src} x={n.x} y={n.y} width={n.w} height={n.h} preserveAspectRatio="none" transform={turn(n)} />
      {:else if n.kind === "frame"}
        {@const c = FRAME_COLORS[frameData(n.data).color]?.color ?? FRAME_COLORS.default.color}
        <rect class="frame" x={n.x} y={n.y} width={n.w} height={n.h} rx={Math.min(n.w, n.h) * 0.04} style:--fc={c} />
      {:else if n.kind === "drawing"}
        {@const d = drawingData(n.data)}
        <svg x={n.x} y={n.y} width={n.w} height={n.h} viewBox="{d.view.x} {d.view.y} {d.view.w} {d.view.h}" preserveAspectRatio="none" overflow="visible">
          {#each d.strokes as s (s.id)}
            <path d={strokePath(s)} fill={inkColor(s.color)} fill-opacity={s.tool === "marker" ? MARKER_OPACITY : 1} />
          {/each}
        </svg>
      {:else}
        <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={Math.min(n.w, n.h) * 0.06} fill={nodeFill(n)} transform={turn(n)} />
      {/if}
    {/each}
    {#if labels}
      <!-- Each card's first line, inside it (clipped by its own viewport), at the card's text size. -->
      {#each sorted as n (n.id)}
        {@const text = labelOf(n)}
        {#if text}
          {@const size = n.kind === "frame" ? 18 : Math.max(10, Math.min(Number((n.data as { fontSize?: number })?.fontSize) || 16, n.h * 0.7))}
          <svg x={n.x} y={n.y} width={n.w} height={n.kind === "frame" ? 40 : n.h} class="label" class:on-frame={n.kind === "frame"} style:--fc={n.kind === "frame" ? FRAME_COLORS[frameData(n.data).color]?.color : undefined}>
            <text x={size * 0.7} y={size * 1.5} font-size={size}>{text}</text>
          </svg>
        {/if}
      {/each}
    {/if}
  </svg>
{/if}

<style>
  .label text {
    fill: var(--text);
    font-family: inherit;
    font-weight: 600;
    opacity: 0.85;
  }
  .label.on-frame text {
    fill: var(--fc, var(--text));
  }
  .frame {
    fill: color-mix(in srgb, var(--fc) 14%, transparent);
    stroke: color-mix(in srgb, var(--fc) 60%, transparent);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    /* Names the shapes' colors (as the minimap does). */
    --mm-media: color-mix(in srgb, var(--text-muted) 45%, transparent);
    --mm-card: color-mix(in srgb, var(--text) 18%, var(--panel-solid));
  }
</style>
