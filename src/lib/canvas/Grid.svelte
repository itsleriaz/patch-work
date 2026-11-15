<script lang="ts">
  import { camera } from "../app.svelte";
  import { settings } from "../settings.svelte";

  /**
   * The background grid, as an inline SVG with exact positions.
   * - Not a repeated CSS background: engines round its tile size to whole pixels, so the error
   *   added up across the screen and the grid drifted and snapped back while zooming.
   * - Not a canvas: a canvas is its own compositing layer, so the camera layer above it got one
   *   too, and its text was drawn once and then only stretched when zooming (blurry).
   * An SVG is painted like normal content. A row of dots is one line dashed with zero-length
   * round dashes, so even the densest grid is about sixty short paths.
   *
   * Spacing grows ×5 when cells get too small on screen; the finer level fades out as it
   * shrinks instead of popping away.
   */

  /** Cells smaller than this on screen (CSS px) aren't drawn; up to twice that, they fade. */
  const MIN_CELL = 14;
  const DOT_SIZE = 2.4;
  /** Lines are the grid color at this opacity (they cover more area than dots). */
  const LINE_ALPHA = 0.55;

  interface Level {
    step: number;
    alpha: number;
    d: string;
  }

  const levels = $derived.by((): Level[] => {
    const { x, y, zoom, width: w, height: h } = camera;
    const style = settings.grid;
    // A broken zoom (0, NaN) would loop forever below.
    if (style === "none" || !w || !h || !(zoom > 0) || !Number.isFinite(zoom)) return [];
    // The finest level at least MIN_CELL apart, and how visible it is; the next level is solid.
    let step = settings.gridSize * zoom;
    while (step < MIN_CELL) step *= 5;
    const fade = Math.min(1, (step - MIN_CELL) / MIN_CELL);
    const dpr = window.devicePixelRatio || 1;
    const make = (s: number, alpha: number, skip: number): Level => ({ step: s, alpha, d: path(style, x, y, w, h, s, skip, dpr) });
    return fade < 1 ? [make(step * 5, 1, 0), make(step, fade, 5)] : [make(step, 1, 0)];
  });

  /**
   * One level's path, `step` screen px apart. Dots: one dashed line per row, starting on a grid
   * point. Lines: `skip` > 0 leaves out every skip-th line, which the coarser level draws.
   */
  function path(style: string, cx: number, cy: number, w: number, h: number, step: number, skip: number, dpr: number) {
    // Grid index of the first line or dot on screen, and its screen position.
    const i0 = Math.ceil(-cx / step), j0 = Math.ceil(-cy / step);
    const x0 = cx + i0 * step, y0 = cy + j0 * step;
    const r = (v: number) => Math.round(v * 100) / 100;
    let d = "";
    if (style === "dots") {
      for (let y = y0; y <= h + DOT_SIZE; y += step) d += `M${r(x0)} ${r(y)}H${r(w + step)}`;
      return d;
    }
    // 1-px lines on the device pixel grid stay crisp; each rounds on its own, so nothing drifts.
    const crisp = (v: number) => r((Math.round(v * dpr) + 0.5) / dpr);
    const keep = (i: number) => !skip || ((i % skip) + skip) % skip !== 0;
    for (let i = i0, x = x0; x <= w; i++, x += step) if (keep(i)) d += `M${crisp(x)} 0V${h}`;
    for (let j = j0, y = y0; y <= h; j++, y += step) if (keep(j)) d += `M0 ${crisp(y)}H${w}`;
    return d;
  }
</script>

{#if levels.length}
  <svg class="grid" class:dots={settings.grid === "dots"} aria-hidden="true">
    {#each levels as level, i (i)}
      <path
        d={level.d}
        opacity={settings.grid === "dots" ? level.alpha : level.alpha * LINE_ALPHA}
        stroke-dasharray={settings.grid === "dots" ? `0 ${level.step}` : undefined}
        stroke-width={settings.grid === "dots" ? DOT_SIZE : 1 / (window.devicePixelRatio || 1)}
      />
    {/each}
  </svg>
{/if}

<style>
  .grid {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: hidden;
  }
  path {
    fill: none;
    stroke: var(--grid-dot);
  }
  .dots path {
    stroke-linecap: round;
  }
</style>
