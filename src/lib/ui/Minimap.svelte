<script lang="ts">
  import { camera, doc, selection } from "../app.svelte";
  import { aabb, union, type Point } from "../doc/geometry";
  import type { CanvasNode, Rect } from "../doc/types";
  import { frames } from "../frame/frames.svelte";
  import { FRAME_COLORS, frameData } from "../frame/model";
  import { play } from "../juice/sound";
  import { visibleWorld } from "../outline/outline.svelte";
  import { pinColor, pinData } from "../pin/model";
  import { settings } from "../settings.svelte";
  import { nodeFill } from "../canvas/fill";

  /**
   * An overview of the board, atop the navigator in the bottom-left corner (setting "Minimap", M): every node as a
   * simple shape, and the part of the board in view as a rectangle. Click or drag to move the
   * view (grabbing the rectangle keeps the offset); the wheel zooms the board around the view's
   * middle.
   *
   * The SVG's viewBox is in world units, so moving the camera only changes the viewBox and the view
   * rectangle; the shapes themselves are redrawn only when the board changes.
   */

  let { width }: { width: number } = $props();
  const W = $derived(width);
  const H = 130;
  /** Room around the content, as a share of its size. */
  const PAD = 0.08;

  // What's drawn: everything not hidden in a collapsed frame; frames first (under the rest), pins last.
  const shown = $derived(doc.nodeList.filter((n) => !frames.hidden.has(n.id)));
  const frameNodes = $derived(shown.filter((n) => n.kind === "frame"));
  const pinNodes = $derived(shown.filter((n) => n.kind === "pin"));
  const blocks = $derived(shown.filter((n) => n.kind !== "frame" && n.kind !== "pin").sort((a, b) => a.z - b.z));

  const content = $derived(union(shown.map(aabb)));
  const view = $derived(visibleWorld());

  /** While dragging, the map holds still (it would otherwise grow under the pointer). */
  let frozen = $state<Rect | null>(null);

  /** The world rectangle the map shows: the content with some room, and the view. */
  const box = $derived.by((): Rect => {
    if (frozen) return frozen;
    const c = content ?? view;
    const pad = Math.max(c.w, c.h) * PAD;
    return union([{ x: c.x - pad, y: c.y - pad, w: c.w + pad * 2, h: c.h + pad * 2 }, view])!;
  });
  /** World units per minimap pixel. */
  const unit = $derived(Math.max(box.w / W, box.h / H));

  const fillOf = (n: CanvasNode) => (selection.has(n.id) ? "var(--accent)" : nodeFill(n));

  /** The world point under the pointer (the map is letterboxed in its box). */
  function toWorld(e: PointerEvent | WheelEvent, el: Element): Point {
    const r = el.getBoundingClientRect();
    const s = Math.min(r.width / box.w, r.height / box.h);
    const ox = r.left + (r.width - box.w * s) / 2, oy = r.top + (r.height - box.h * s) / 2;
    return { x: box.x + (e.clientX - ox) / s, y: box.y + (e.clientY - oy) / s };
  }

  /** Puts a world point in the middle of the uncovered view. */
  function centerOn(p: Point, animate: boolean) {
    const target = { zoom: camera.zoom, x: camera.centerX - p.x * camera.zoom, y: camera.height / 2 - p.y * camera.zoom };
    if (animate && !settings.calm) camera.animateTo(target, 200);
    else camera.moveTo(target);
  }

  let grab: Point | null = null;

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as Element;
    const p = toWorld(e, el);
    const v = view;
    const inside = p.x >= v.x && p.x <= v.x + v.w && p.y >= v.y && p.y <= v.y + v.h;
    // Grabbing the view rectangle keeps where it was grabbed; elsewhere the view jumps there.
    grab = inside ? { x: p.x - (v.x + v.w / 2), y: p.y - (v.y + v.h / 2) } : { x: 0, y: 0 };
    frozen = box;
    (el as HTMLElement).setPointerCapture(e.pointerId);
    if (!inside) centerOn(p, true);
    play("tap", { volume: 0.4, pitch: inside ? 1.15 : 1 });
  }

  function move(e: PointerEvent) {
    if (!grab) return;
    const p = toWorld(e, e.currentTarget as Element);
    centerOn({ x: p.x - grab.x, y: p.y - grab.y }, false);
  }

  function up() {
    grab = null;
    frozen = null;
  }

  // Not passive, so the wheel can be kept from doing anything else.
  function wheelListener(el: Element) {
    el.addEventListener("wheel", wheel as EventListener, { passive: false });
    return () => el.removeEventListener("wheel", wheel as EventListener);
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 16 : 1) * 0.0015);
    if (settings.smoothCamera && !settings.calm) camera.zoomSmooth(camera.centerX, camera.height / 2, factor);
    else camera.zoomAt(camera.centerX, camera.height / 2, factor);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="minimap" style:width="{W}px" style:height="{H}px">
  <svg
    viewBox="{box.x} {box.y} {box.w} {box.h}"
    preserveAspectRatio="xMidYMid meet"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    {@attach wheelListener}
    aria-label="Minimap"
    role="img"
  >
    {#each frameNodes as f (f.id)}
      {@const c = FRAME_COLORS[frameData(f.data).color]?.color ?? FRAME_COLORS.default.color}
      <rect class="frame" class:selected={selection.has(f.id)} x={f.x} y={f.y} width={f.w} height={f.h} rx={unit * 3} style:--fc={c} />
    {/each}
    {#each blocks as n (n.id)}
      {@const r = aabb(n)}
      <rect class="block" x={r.x} y={r.y} width={Math.max(r.w, unit)} height={Math.max(r.h, unit)} rx={Math.min(r.w, r.h) * 0.08} fill={fillOf(n)} />
    {/each}
    {#each pinNodes as p (p.id)}
      <circle class="pin" cx={p.x} cy={p.y} r={unit * 3.5} fill={selection.has(p.id) ? "var(--accent)" : pinColor(pinData(p.data))} />
    {/each}
    <rect class="view" x={view.x} y={view.y} width={view.w} height={view.h} rx={unit * 2} />
  </svg>
</div>

<style>
  .minimap {
    box-sizing: border-box;
    padding: 4px;
    border-radius: calc(8px * var(--round));
    /* Solid: a frosted map would be tinted by whatever card is under it. */
    background: var(--panel-solid);
    --mm-media: color-mix(in srgb, var(--text-muted) 45%, transparent);
    --mm-card: color-mix(in srgb, var(--text) 18%, var(--panel-solid));
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    cursor: pointer;
    touch-action: none;
  }
  rect,
  circle {
    vector-effect: non-scaling-stroke;
  }
  .block {
    stroke: color-mix(in srgb, var(--text) 22%, transparent);
    stroke-width: 0.5;
  }
  .frame {
    fill: color-mix(in srgb, var(--fc) 14%, transparent);
    stroke: color-mix(in srgb, var(--fc) 60%, transparent);
    stroke-width: 1;
  }
  .frame.selected {
    stroke: var(--accent);
    stroke-width: 1.5;
  }
  .pin {
    stroke: var(--panel-solid);
    stroke-width: 1;
  }
  .view {
    fill: color-mix(in srgb, var(--accent) 12%, transparent);
    stroke: var(--accent);
    stroke-width: 1.5;
    cursor: grab;
  }
</style>
