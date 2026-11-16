<script lang="ts">
  import { camera } from "../app.svelte";
  import { settings } from "../settings.svelte";

  /**
   * The background grid, as an inline SVG with exact positions.
   * - Not a repeated CSS background: engines round its tile size to whole pixels, so the error
   *   added up across the screen and the grid drifted and snapped back while zooming.
   * - Not a canvas: a canvas is its own compositing layer, so the camera layer above it got one
   *   too, and its text was drawn once and then only stretched when zooming (blurry).
   * An SVG is painted like normal content, so it's repainted on every frame the camera moves:
   * that has to be cheap. Dots are an SVG pattern (one dot, tiled at its exact, fractional
   * spacing) filling the view: a single textured rectangle. Rows of round-capped zero-length
   * dashes looked the same but went down the GPU's slow path for every dot, and drawing them was
   * most of a pan or zoom frame's cost on older GPUs. Lines stay as paths, on the device pixel grid
   * so they stay crisp.
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
    /** Dots: where the pattern's tiles start (a dot sits in each tile's middle). */
    x: number;
    y: number;
    /** Lines: the path. */
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
    const make = (s: number, alpha: number, skip: number): Level => {
      if (style === "dots") return { step: s, alpha, x: tileStart(x, s), y: tileStart(y, s), d: "" };
      return { step: s, alpha, x: 0, y: 0, d: linesPath(x, y, w, h, s, skip, dpr) };
    };
    return fade < 1 ? [make(step * 5, 1, 0), make(step, fade, 5)] : [make(step, 1, 0)];
  });

  /** A tile start half a step before a grid point, kept near 0 (the pattern repeats both ways). */
  const tileStart = (origin: number, step: number) => (((origin % step) + step) % step) - step / 2;

  /**
   * One level's lines, `step` screen px apart. `skip` > 0 leaves out every skip-th line, which the
   * coarser level draws.
   */
  function linesPath(cx: number, cy: number, w: number, h: number, step: number, skip: number, dpr: number) {
    // Grid index of the first line on screen, and its screen position.
    const i0 = Math.ceil(-cx / step), j0 = Math.ceil(-cy / step);
    const x0 = cx + i0 * step, y0 = cy + j0 * step;
    const r = (v: number) => Math.round(v * 100) / 100;
    // 1-px lines on the device pixel grid stay crisp; each rounds on its own, so nothing drifts.
    const crisp = (v: number) => r((Math.round(v * dpr) + 0.5) / dpr);
    const keep = (i: number) => !skip || ((i % skip) + skip) % skip !== 0;
    let d = "";
    for (let i = i0, x = x0; x <= w; i++, x += step) if (keep(i)) d += `M${crisp(x)} 0V${h}`;
    for (let j = j0, y = y0; y <= h; j++, y += step) if (keep(j)) d += `M0 ${crisp(y)}H${w}`;
    return d;
  }
</script>

{#if levels.length}
  <svg class="grid" aria-hidden="true">
    {#if settings.grid === "dots"}
      <defs>
        {#each levels as level, i (i)}
          <pattern id="pw-grid-dots-{i}" patternUnits="userSpaceOnUse" x={level.x} y={level.y} width={level.step} height={level.step}>
            <circle cx={level.step / 2} cy={level.step / 2} r={DOT_SIZE / 2} fill-opacity={level.alpha} />
          </pattern>
        {/each}
      </defs>
      {#each levels as _, i (i)}
        <rect width="100%" height="100%" fill="url(#pw-grid-dots-{i})" />
      {/each}
    {:else}
      {#each levels as level, i (i)}
        <path d={level.d} opacity={level.alpha * LINE_ALPHA} stroke-width={1 / (window.devicePixelRatio || 1)} />
      {/each}
    {/if}
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
  circle {
    fill: var(--grid-dot);
  }
  path {
    fill: none;
    stroke: var(--grid-dot);
  }
</style>
