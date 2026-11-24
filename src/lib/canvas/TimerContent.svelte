<script lang="ts">
  import { ChevronDown, Flag, Pause, Play, RotateCcw } from "@lucide/svelte";
  import { camera, ui } from "../app.svelte";
  import type { CanvasNode } from "../doc/types";
  import { formatTime, parseDuration, shown, timerData } from "../timer/model";
  import { lapTimer, resetTimer, runOf, setDuration, setTimer, timerUi, toggleTimer } from "../timer/timers.svelte";
  import { tip } from "../ui/tips.svelte";
  import { fitSize } from "./flow";

  /**
   * A timer card: its label, the time (left, for a countdown; run, for a stopwatch), play/pause,
   * reset, and a stopwatch's laps or a countdown's lengths. Like a counter, its height follows the
   * content and corner handles scale its font. The time is read from the shared clock.
   */
  let { node }: { node: CanvasNode } = $props();

  const d = $derived(timerData(node.data));
  const run = $derived(runOf(node.id));
  const running = $derived(run.startedAt !== null);
  const ms = $derived(shown(d, run, timerUi.now));
  const stopwatch = $derived(d.mode === "stopwatch");
  const fresh = $derived(!running && !run.done && run.banked === 0);
  const progress = $derived(stopwatch ? 0 : Math.min(1, 1 - ms / d.duration));
  const editing = $derived(timerUi.editing?.nodeId === node.id ? timerUi.editing.field : null);
  // The latest laps first, each with its own time and the total.
  const laps = $derived(run.laps.map((total, i) => ({ n: i + 1, total, own: total - (run.laps[i - 1] ?? 0) })).slice(-4).reverse());
  const pulse = $derived(timerUi.rang[node.id]);

  let box: HTMLDivElement;
  // Height follows the content, like a counter.
  $effect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize[0]?.blockSize ?? box.offsetHeight;
      if (h > 0 && Math.abs(h - node.h) > 0.5) fitSize(node, node.w, h);
    });
    observer.observe(box);
    return () => observer.disconnect();
  });

  // ---------------------------------------------------------------- inline editors

  const edit = (field: "label" | "duration") => (e: MouseEvent) => {
    e.stopPropagation();
    if (field === "duration" && (stopwatch || running)) return;
    timerUi.editing = { nodeId: node.id, field };
  };

  function focus(el: HTMLInputElement) {
    el.focus({ preventScroll: true });
    el.select();
  }

  let cancelled = false;
  let invalid = $state(false);
  function commit(field: string, raw: string): boolean {
    if (timerUi.editing?.nodeId !== node.id) return true;
    if (cancelled) {
      cancelled = false;
      timerUi.editing = null;
      return true;
    }
    if (field === "label") {
      timerUi.editing = null;
      setTimer(node.id, "Rename timer", { label: raw.trim() });
      return true;
    }
    const ms = raw.trim() ? parseDuration(raw) : d.duration;
    if (ms === null) {
      invalid = true;
      return false;
    }
    invalid = false;
    timerUi.editing = null;
    setDuration(node.id, ms);
    return true;
  }

  function onKeydown(e: KeyboardEvent, field: string) {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commit(field, (e.target as HTMLInputElement).value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelled = true;
      (e.target as HTMLInputElement).blur();
    }
  }

  function openMenu(e: MouseEvent) {
    e.stopPropagation();
    const v = document.querySelector(".viewport")?.getBoundingClientRect();
    timerUi.menu = node.id;
    ui.menu = { x: e.clientX, y: e.clientY, world: camera.toWorld(e.clientX - (v?.left ?? 0), e.clientY - (v?.top ?? 0)), target: "timer" };
  }

  const stop = (e: Event) => e.stopPropagation();
  const click = (fn: (id: string) => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn(node.id);
  };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="timer" class:running class:done={run.done} bind:this={box} style:font-size="{d.fontSize}px">
  {#key pulse}<div class="ring" class:pulse={pulse !== undefined}></div>{/key}

  <div class="label" ondblclick={edit("label")} {@attach tip("Double-click to rename")}>
    {#if editing === "label"}
      <input class="edit label-edit" data-editor value={d.label} placeholder={stopwatch ? "Stopwatch" : "Timer"} spellcheck="false" onpointerdown={stop} ondblclick={stop} onkeydown={(e) => onKeydown(e, "label")} onblur={(e) => commit("label", (e.target as HTMLInputElement).value)} {@attach focus} />
    {:else}
      <span class:placeholder={!d.label}>{d.label || (stopwatch ? "Stopwatch" : "Timer")}</span>
    {/if}
  </div>

  <div class="time" ondblclick={edit("duration")} {@attach tip(!stopwatch && !running ? "Double-click to set the time" : null)}>
    {#if editing === "duration"}
      <input
        class="edit time-edit"
        class:invalid
        data-editor
        value={formatTime(d.duration)}
        placeholder="5:00"
        spellcheck="false"
        onpointerdown={stop}
        ondblclick={stop}
        oninput={() => (invalid = false)}
        onkeydown={(e) => onKeydown(e, "duration")}
        onblur={(e) => {
          if (!commit("duration", (e.target as HTMLInputElement).value)) timerUi.editing = null;
        }}
        {@attach focus}
      />
    {:else if run.done}
      <span class="digits">Done</span>
    {:else}
      <span class="digits">{formatTime(ms, { up: !stopwatch })}</span>{#if stopwatch}<span class="tenths">.{Math.floor((ms % 1000) / 100)}</span>{/if}
    {/if}
  </div>

  <!-- A press here mustn't start a canvas gesture: the canvas captures the pointer on the first
       move, and the button would then never get its click. -->
  <div class="controls" role="presentation" onpointerdown={stop}>
    <button class="btn" aria-label="Reset" disabled={fresh} onclick={click(resetTimer)} ondblclick={stop} {@attach tip("Reset")}><RotateCcw /></button>
    <button class="btn main" aria-label={running ? "Pause" : "Start"} onclick={click(toggleTimer)} ondblclick={stop}>
      {#if running}<Pause fill="currentColor" />{:else}<Play fill="currentColor" />{/if}
    </button>
    {#if stopwatch}
      <button class="btn" aria-label="Lap" disabled={!running} onclick={click(lapTimer)} ondblclick={stop} {@attach tip("Lap")}><Flag /></button>
    {:else}
      <button class="btn" aria-label="Length" onclick={openMenu} ondblclick={stop} {@attach tip("Length and mode")}><ChevronDown /></button>
    {/if}
  </div>

  {#if !stopwatch}
    <div class="bar"><div class="fill" style:width="{progress * 100}%"></div></div>
  {/if}
  {#if laps.length}
    <ol class="laps">
      {#each laps as l (l.n)}
        <li><span class="n">Lap {l.n}</span><span>{formatTime(l.own, { tenths: true })}</span><span class="total">{formatTime(l.total, { tenths: true })}</span></li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .timer {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    padding: 0.65em 0.8em 0.8em;
    border-radius: calc(0.7em * var(--round));
    background: var(--panel-solid);
    color: var(--text);
    box-shadow: 0 calc(3px * var(--shadow-zoom)) calc(14px * var(--shadow-zoom)) var(--node-shadow);
    text-align: center;
  }
  /* The finish pulse: a ring that swells and fades (box-shadow only, paint-only: HANDOFF §8). */
  .ring {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
  }
  .ring.pulse {
    animation: ring 1.4s ease-out 3;
  }
  @keyframes ring {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 70%, transparent);
    }
    100% {
      box-shadow: 0 0 0 1.2em color-mix(in srgb, var(--accent) 0%, transparent);
    }
  }
  :global(:root[data-calm]) .ring.pulse {
    animation: none;
  }
  .label {
    font-size: 0.85em;
    font-weight: 600;
    color: var(--text-muted);
    min-height: 1.3em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .placeholder {
    opacity: 0.6;
  }
  .time {
    margin-top: 0.1em;
    display: flex;
    align-items: baseline;
    justify-content: center;
    cursor: default;
  }
  .digits {
    font-size: 2.4em;
    font-weight: 700;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  .tenths {
    font-size: 1.3em;
    font-weight: 600;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .running .digits {
    color: var(--accent);
  }
  .done .digits {
    color: var(--accent);
  }
  .controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6em;
    margin-top: 0.4em;
  }
  .btn {
    /* Buttons don't inherit font-size; everything here is in em. */
    font: inherit;
    flex: none;
    width: 2em;
    height: 2em;
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--control-bg);
    color: var(--text);
    cursor: pointer;
    transition: background 120ms;
  }
  .btn.main {
    width: 2.6em;
    height: 2.6em;
    background: var(--accent);
    color: var(--on-accent);
  }
  .btn:hover:not(:disabled):not(.main) {
    background: color-mix(in srgb, var(--accent) 18%, var(--control-bg));
    color: var(--accent);
  }
  .btn.main:hover {
    background: color-mix(in srgb, var(--accent) 85%, var(--text));
  }
  .btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .btn :global(svg) {
    width: 1em;
    height: 1em;
  }
  .btn.main :global(svg) {
    width: 1.1em;
    height: 1.1em;
  }
  .bar {
    height: 0.3em;
    margin-top: 0.6em;
    border-radius: calc(0.15em * var(--round));
    background: var(--control-bg);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
  }
  .laps {
    list-style: none;
    margin: 0.6em 0 0;
    padding: 0;
    font-size: 0.8em;
    font-variant-numeric: tabular-nums;
  }
  .laps li {
    display: flex;
    justify-content: space-between;
    gap: 0.6em;
    padding: 0.15em 0;
    border-top: 1px solid var(--control-bg);
  }
  .laps .n,
  .laps .total {
    color: var(--text-muted);
  }
  .edit {
    font: inherit;
    color: inherit;
    background: var(--control-bg);
    border: none;
    border-radius: calc(0.3em * var(--round));
    outline: 0.1em solid var(--accent);
    padding: 0 0.3em;
    text-align: center;
    user-select: text;
    -webkit-user-select: text;
  }
  .edit.invalid {
    outline-color: var(--danger, #d0605f);
  }
  .label-edit {
    width: 80%;
    font-weight: 600;
  }
  .time-edit {
    width: 4.2em;
    font-size: 2.4em;
    font-weight: 700;
    line-height: 1.15;
  }
</style>
