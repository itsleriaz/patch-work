<script lang="ts">
  import { fitSize } from "./flow";
  import { tip } from "../ui/tips.svelte";
  import { Minus, Plus } from "@lucide/svelte";
  import { count, counterUi, setCounter } from "../counter/count.svelte";
  import { counterData } from "../counter/model";
  import type { CanvasNode } from "../doc/types";
  import { play } from "../juice/sound";
  import { settings } from "../settings.svelte";

  let { node }: { node: CanvasNode } = $props();

  const d = $derived(counterData(node.data));
  const reached = $derived(!!d.goal && d.value >= d.goal);
  const editing = $derived(counterUi.editing?.nodeId === node.id ? counterUi.editing.field : null);

  let box: HTMLDivElement;

  // Height follows the content, like text and checklists.
  $effect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize[0]?.blockSize ?? box.offsetHeight;
      if (h > 0 && Math.abs(h - node.h) > 0.5) fitSize(node, node.w, h);
    });
    observer.observe(box);
    return () => observer.disconnect();
  });

  // The number rolls in from the direction it moved.
  let dir = $state<"up" | "down">("up");
  let last: number | null = null;
  $effect.pre(() => {
    const v = d.value;
    if (last !== null && v !== last) dir = v > last ? "up" : "down";
    last = v;
  });

  // Reaching the goal celebrates (not on load, and not twice in a row).
  let wasReached: boolean | null = null;
  let confetti = $state(0);
  $effect(() => {
    const r = reached;
    if (wasReached === false && r) {
      play("celebrate", { volume: 0.8 });
      if (!settings.calm) confetti++;
    }
    wasReached = r;
  });
  const pieces = Array.from({ length: 16 }, (_, i) => ({
    angle: (i / 16) * 360 + Math.random() * 20,
    dist: 2 + Math.random() * 2,
    hue: Math.round(Math.random() * 360),
    delay: Math.random() * 80,
  }));

  // A limit stopped the count: a short shake.
  let shake = $state(false);
  $effect(() => {
    const b = counterUi.blocked;
    if (b?.nodeId !== node.id || settings.calm) return;
    shake = true;
    const t = setTimeout(() => (shake = false), 280);
    return () => clearTimeout(t);
  });

  // Holding a button repeats, faster the longer it's held.
  let repeat: ReturnType<typeof setTimeout> | undefined;
  function press(e: PointerEvent, sign: 1 | -1) {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const steps = sign * (e.shiftKey ? 10 : 1);
    if (!count(node.id, steps)) return;
    let delay = 380;
    const again = () => {
      if (!count(node.id, steps)) return;
      delay = Math.max(35, delay * 0.75);
      repeat = setTimeout(again, delay);
    };
    repeat = setTimeout(again, delay);
  }
  function release() {
    clearTimeout(repeat);
    repeat = undefined;
  }
  // Keyboard activation of a focused button (pointer presses are handled above).
  function keyClick(e: MouseEvent, sign: 1 | -1) {
    if (e.detail === 0) count(node.id, sign);
  }

  // ---------------------------------------------------------------- inline editors

  function edit(field: "label" | "value" | "goal" | "step") {
    return (e: MouseEvent) => {
      e.stopPropagation();
      counterUi.editing = { nodeId: node.id, field };
    };
  }

  function initial(field: string): string {
    if (field === "label") return d.label;
    if (field === "value") return String(d.value);
    if (field === "goal") return d.goal ? String(d.goal) : "";
    return String(d.step);
  }

  function focus(el: HTMLInputElement) {
    el.focus({ preventScroll: true });
    el.select();
  }

  let cancelled = false;
  function commit(field: string, raw: string) {
    if (counterUi.editing?.nodeId !== node.id) return;
    counterUi.editing = null;
    if (cancelled) return void (cancelled = false);
    const n = parseInt(raw.replace(/[^\d-]/g, ""), 10);
    if (field === "label") setCounter(node.id, "Rename counter", { label: raw.trim() });
    else if (field === "value" && Number.isFinite(n)) setCounter(node.id, "Set count", { value: n });
    else if (field === "goal") setCounter(node.id, n > 0 ? "Set goal" : "Remove goal", { goal: n > 0 ? n : null });
    else if (field === "step" && n > 0) setCounter(node.id, "Step size", { step: n });
  }

  function onKeydown(e: KeyboardEvent, field: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(field, (e.target as HTMLInputElement).value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelled = true;
      (e.target as HTMLInputElement).blur();
    }
  }

  const stop = (e: Event) => e.stopPropagation();
</script>

{#snippet editor(field: "label" | "value" | "goal" | "step", cls: string, placeholder: string)}
  <input
    class="edit {cls}"
    data-editor
    value={initial(field)}
    {placeholder}
    inputmode={field === "label" ? "text" : "numeric"}
    spellcheck="false"
    onpointerdown={stop}
    ondblclick={stop}
    onkeydown={(e) => onKeydown(e, field)}
    onblur={(e) => commit(field, (e.target as HTMLInputElement).value)}
    {@attach focus}
  />
{/snippet}

<div class="counter" class:has-goal={!!d.goal} class:reached class:shake bind:this={box} style:font-size="{d.fontSize}px">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="label" ondblclick={edit("label")} {@attach tip("Double-click to rename")}>
    {#if editing === "label"}
      {@render editor("label", "label-edit", "Counter")}
    {:else}
      <span class:placeholder={!d.label}>{d.label || "Counter"}</span>
    {/if}
  </div>

  <div class="main">
    <button
      class="btn"
      aria-label="Decrease"
      class:limit={d.value === 0}
      onpointerdown={(e) => press(e, -1)}
      onpointerup={release}
      onpointercancel={release}
      onlostpointercapture={release}
      onclick={(e) => keyClick(e, -1)}
      ondblclick={stop}
    >
      <Minus strokeWidth={2.6} />
    </button>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="value" ondblclick={edit("value")} {@attach tip("Double-click to type a value")}>
      {#if editing === "value"}
        {@render editor("value", "num-edit", "0")}
      {:else}
        {#key d.value}<span class="num {dir}">{d.value}</span>{/key}
      {/if}
      {#if d.goal || editing === "goal"}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="of" ondblclick={edit("goal")} {@attach tip("Double-click to change the goal")}>
          / {#if editing === "goal"}{@render editor("goal", "goal-edit", "goal")}{:else}{d.goal}{/if}
        </span>
      {/if}
    </div>

    <button
      class="btn"
      aria-label="Increase"
      class:limit={reached}
      onpointerdown={(e) => press(e, 1)}
      onpointerup={release}
      onpointercancel={release}
      onlostpointercapture={release}
      onclick={(e) => keyClick(e, 1)}
      ondblclick={stop}
    >
      <Plus strokeWidth={2.6} />
    </button>
  </div>

  {#if d.goal}
    <div class="bar"><div class="fill" style:width="{(d.value / d.goal) * 100}%"></div></div>
  {/if}
  {#if d.step !== 1 || editing === "step"}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="meta" ondblclick={edit("step")} {@attach tip("Double-click to change the step")}>
      step {#if editing === "step"}{@render editor("step", "step-edit", "1")}{:else}{d.step}{/if}
    </div>
  {/if}

  {#key confetti}
    {#if confetti}
      <div class="confetti" aria-hidden="true">
        {#each pieces as p, i (i)}
          <span style:--a="{p.angle}deg" style:--d="{p.dist}em" style:--h={p.hue} style:animation-delay="{p.delay}ms"></span>
        {/each}
      </div>
    {/if}
  {/key}
</div>

<style>
  .counter {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    padding: 0.65em 0.8em 0.8em;
    border-radius: calc(0.7em * var(--round));
    background: var(--panel-solid);
    color: var(--text);
    box-shadow: 0 calc(3px * var(--inv-zoom)) calc(14px * var(--inv-zoom)) var(--node-shadow);
    text-align: center;
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
  .main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4em;
    margin-top: 0.2em;
  }
  .btn {
    /* Buttons don't inherit font-size; everything here is in em. */
    font: inherit;
    flex: none;
    width: 2.2em;
    height: 2.2em;
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--control-bg);
    color: var(--text);
    cursor: pointer;
    /* The press shrinks instantly: an animated scale gets a compositing layer (HANDOFF §8). */
    transition: background 120ms;
  }
  .btn:hover:not(.limit) {
    background: color-mix(in srgb, var(--accent) 18%, var(--control-bg));
    color: var(--accent);
  }
  .btn:active:not(.limit) {
    scale: 0.88;
  }
  /* At 0 or the goal: dimmed, but still pressable, so a press can bump and buzz. */
  .btn.limit {
    opacity: 0.35;
  }
  .btn :global(svg) {
    width: 1.1em;
    height: 1.1em;
  }
  .value {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.25em;
    overflow: hidden;
    cursor: text;
  }
  .num {
    position: relative;
    display: inline-block;
    font-size: 2.4em;
    font-weight: 700;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  .num.up {
    animation: roll-up 220ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }
  .num.down {
    animation: roll-down 220ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }
  .reached .num {
    color: var(--accent);
  }
  .of {
    font-size: 1.1em;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .bar {
    height: 0.3em;
    margin-top: 0.55em;
    border-radius: calc(0.15em * var(--round));
    background: var(--control-bg);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 260ms cubic-bezier(0.34, 1.3, 0.64, 1);
  }
  .meta {
    margin-top: 0.4em;
    font-size: 0.72em;
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
  .label-edit {
    width: 80%;
    font-weight: 600;
  }
  .num-edit {
    width: 3.2em;
    font-size: 2.4em;
    font-weight: 700;
    line-height: 1.15;
  }
  .goal-edit {
    width: 2.6em;
  }
  .step-edit {
    width: 2.6em;
  }
  .shake {
    animation: shake 260ms ease-in-out;
  }
  .confetti {
    position: absolute;
    left: 50%;
    top: 45%;
    width: 0;
    height: 0;
    pointer-events: none;
  }
  .confetti span {
    position: absolute;
    width: 0.4em;
    height: 0.25em;
    border-radius: calc(0.06em * var(--round));
    background: hsl(var(--h) 85% 60%);
    opacity: 0;
    animation: burst 900ms cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
  }
  @keyframes burst {
    0% {
      opacity: 1;
      transform: rotate(var(--a)) translateX(0) rotate(0deg);
    }
    100% {
      opacity: 0;
      transform: rotate(var(--a)) translateX(var(--d)) rotate(260deg) translateY(1.2em);
    }
  }
  /* The number rolls in by position and color, not translate and opacity: those would get a
     compositing layer on every count (blurry flash, HANDOFF §8). */
  @keyframes roll-up {
    from {
      top: 0.45em;
      color: transparent;
    }
  }
  @keyframes roll-down {
    from {
      top: -0.45em;
      color: transparent;
    }
  }
  @keyframes shake {
    25% {
      translate: -0.18em 0;
    }
    75% {
      translate: 0.18em 0;
    }
  }
  :global(:root[data-calm]) .num.up,
  :global(:root[data-calm]) .num.down,
  :global(:root[data-calm]) .shake {
    animation: none;
  }
</style>
