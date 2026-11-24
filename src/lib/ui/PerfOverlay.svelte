<script lang="ts">
  import { camera } from "../app.svelte";
  import { meter, sceneStats, type FrameSummary, type SceneStats } from "../perf";

  const BARS = 120;
  /** Frame time at the top of the graph, ms. */
  const SCALE = 50;
  const W = 204, H = 40;

  let summary = $state<FrameSummary | null>(null);
  let scene = $state<SceneStats | null>(null);
  let graph: HTMLCanvasElement;

  // Text updates 4×/s; the graph redraws with it. Reading the DOM every frame would skew the numbers.
  $effect(() => {
    const release = meter.acquire();
    const update = () => {
      summary = meter.summary(1000);
      scene = sceneStats();
      draw();
    };
    update();
    const timer = setInterval(update, 250);
    return () => {
      clearInterval(timer);
      release();
    };
  });

  function draw() {
    const ctx = graph?.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio;
    graph.width = W * dpr;
    graph.height = H * dpr;
    ctx.scale(dpr, dpr);
    const frames = meter.durations.slice(-BARS);
    const bw = W / BARS;
    // The display's frame interval (the median frame): rAF timing jitters by a ms or so around it,
    // so a frame is late (yellow) only once it missed a vsync, i.e. took half an interval longer.
    const vsync = [...frames].sort((a, b) => a - b)[frames.length >> 1] ?? 16.7;
    frames.forEach((ms, i) => {
      const h = Math.max(1, (Math.min(ms, SCALE) / SCALE) * H);
      ctx.fillStyle = ms > 33 ? "#e5604f" : ms > vsync * 1.5 ? "#e0b34a" : "#5fbf8f";
      ctx.fillRect(W - (frames.length - i) * bw, H - h, Math.max(1, bw - 0.5), h);
    });
    // 60 fps budget.
    const y = H - (16.7 / SCALE) * H;
    ctx.fillStyle = "rgb(255 255 255 / 0.35)";
    ctx.fillRect(0, y, W, 1);
  }

  const levels = $derived(
    scene
      ? Object.entries(scene.levels)
          .sort(([a], [b]) => (Number(a) || Infinity) - (Number(b) || Infinity))
          .map(([level, n]) => `${level}×${n}`)
          .join(" ") || "none"
      : "",
  );
</script>

<!-- Moves left of the side panel while it is open. -->
<div class="perf" aria-hidden="true" style:right="{12 + camera.insetRight}px">
  <div class="top">
    <span class="fps" class:warn={(summary?.fps ?? 60) < 50} class:bad={(summary?.fps ?? 60) < 30}>
      {summary?.fps.toFixed(0) ?? "–"}<small>fps</small>
    </span>
    <span class="ms">
      avg {summary?.avg.toFixed(1)} · p95 {summary?.p95.toFixed(0)} ·
      <b class:bad={(summary?.worst ?? 0) > 33}>max {summary?.worst.toFixed(0)}</b> ms
    </span>
  </div>
  <canvas bind:this={graph} style:width="{W}px" style:height="{H}px"></canvas>
  {#if scene}
    <div class="row"><span>nodes</span>{scene.mounted} mounted / {scene.nodes}</div>
    <div class="row"><span>images</span>{levels}</div>
    <div class="row"><span>decoded</span>≈ {scene.decodedMB} MB</div>
    <div class="row"><span>zoom</span>{Math.round(camera.zoom * 100)}%</div>
  {/if}
</div>

<style>
  .perf {
    position: absolute;
    right: 12px;
    bottom: 12px;
    width: 220px;
    padding: 8px;
    border-radius: calc(10px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    color: var(--text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    line-height: 1.5;
    pointer-events: none;
    user-select: none;
    z-index: 50;
  }
  .top {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .fps {
    font-size: 20px;
    font-weight: 600;
    color: #5fbf8f;
  }
  .fps small {
    font-size: 10px;
    font-weight: 400;
    margin-left: 2px;
    color: var(--text-muted);
  }
  .fps.warn {
    color: #e0b34a;
  }
  .fps.bad,
  b.bad {
    color: #e5604f;
  }
  b {
    font-weight: 500;
  }
  .ms {
    font-size: 10px;
    white-space: nowrap;
  }
  canvas {
    display: block;
    margin: 4px 0 6px;
    border-radius: calc(4px * var(--round));
    background: rgb(0 0 0 / 0.25);
  }
  .row {
    display: flex;
    gap: 6px;
    color: var(--text);
  }
  .row span {
    width: 52px;
    flex-shrink: 0;
    color: var(--text-muted);
  }
</style>
