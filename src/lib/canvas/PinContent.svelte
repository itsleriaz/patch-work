<script lang="ts">
  import { tip } from "../ui/tips.svelte";
  import type { CanvasNode } from "../doc/types";
  import { pinColor, pinData } from "../pin/model";
  import { pinUi, setPin } from "../pin/pins.svelte";

  let { node, selected, target = false }: { node: CanvasNode; selected: boolean; target?: boolean } = $props();

  const d = $derived(pinData(node.data));
  const editing = $derived(pinUi.editing === node.id);
  /** Replays the landing bounce each time a jump arrives here. */
  const landed = $derived(pinUi.arrived?.id === node.id ? pinUi.arrived.key : null);

  function focus(el: HTMLInputElement) {
    el.focus({ preventScroll: true });
    el.select();
  }

  let cancelled = false;
  function commit(value: string) {
    if (pinUi.editing !== node.id) return;
    pinUi.editing = null;
    if (cancelled) return void (cancelled = false);
    setPin(node, "Rename pin", { title: value.trim() });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit((e.target as HTMLInputElement).value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelled = true;
      (e.target as HTMLInputElement).blur();
    }
  }
</script>

<!-- Drawn at a constant size on screen, its tip on the pin's point (the node is a 0×0 box there). -->
<div class="pin" class:selected class:target style:--pc={pinColor(d)} {@attach tip({ text: d.title.trim() || `Pin ${d.slot}`, keys: String(d.slot), detail: "Press the number to jump here" })}>
  <div class="shadow"></div>
  {#key landed}
    <div class="marker" class:landed={landed !== null}>
      <svg viewBox="0 0 30 40" aria-hidden="true">
        <path d="M15 39.5C11 34 3 24.5 3 15a12 12 0 0 1 24 0c0 9.5-8 19-12 24.5Z" />
      </svg>
      <span class="num">{d.slot}</span>
    </div>
  {/key}
  {#if editing}
    <input
      class="title edit"
      data-editor
      value={d.title}
      placeholder="Pin {d.slot}"
      spellcheck="false"
      onpointerdown={(e) => e.stopPropagation()}
      onkeydown={onKeydown}
      onblur={(e) => commit((e.target as HTMLInputElement).value)}
      {@attach focus}
    />
  {:else if d.title}
    <span class="title">{d.title}</span>
  {/if}
</div>

<style>
  .pin {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    transform: scale(var(--inv-zoom));
    transform-origin: 0 0;
    font-size: 13px;
  }
  .marker {
    position: absolute;
    left: -15px;
    top: -40px;
    width: 30px;
    height: 40px;
    transform-origin: 50% 100%;
    /* Lifts by position, not translate: an animated transform gets a compositing layer (HANDOFF §8). */
    transition: top 140ms cubic-bezier(0.34, 1.56, 0.64, 1);
    filter: drop-shadow(0 2px 3px var(--node-shadow));
  }
  .pin:hover .marker {
    top: -43px;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  path {
    fill: var(--pc);
    stroke: var(--handle-bg);
    stroke-width: 2;
    stroke-linejoin: round;
  }
  /* Selected: a ring around the head. */
  .selected .marker::before,
  .target .marker::before {
    content: "";
    position: absolute;
    left: -3px;
    top: -3px;
    width: 36px;
    height: 36px;
    box-sizing: border-box;
    border-radius: 50%;
    border: 2px solid var(--accent);
    animation: ring-in 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .target .marker::before {
    border-style: dashed;
  }
  .num {
    position: absolute;
    left: 0;
    top: 5px;
    width: 30px;
    line-height: 20px;
    text-align: center;
    font-weight: 700;
    font-size: 14px;
    color: var(--on-accent);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  /* Where the tip meets the board. */
  .shadow {
    position: absolute;
    left: -7px;
    top: -3px;
    width: 14px;
    height: 6px;
    border-radius: 50%;
    background: radial-gradient(closest-side, var(--node-shadow), transparent);
  }
  .title {
    position: absolute;
    left: 17px;
    top: -36px;
    max-width: 220px;
    padding: 2px 8px 2px 10px;
    line-height: 18px;
    border-radius: 0 calc(9px * var(--round)) calc(9px * var(--round)) 0;
    background: var(--panel-solid);
    color: var(--text);
    box-shadow: 0 1px 4px var(--node-shadow);
    font-weight: 550;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title.edit {
    font: inherit;
    font-weight: 550;
    width: 160px;
    border: none;
    outline: 1.5px solid var(--accent);
    user-select: text;
    -webkit-user-select: text;
  }
  /* A jump arrived: the pin drops in and settles. */
  .landed {
    animation: land 520ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes land {
    0% {
      translate: 0 -22px;
      scale: 0.9 1.1;
    }
    55% {
      translate: 0 0;
      scale: 1.12 0.86;
    }
    80% {
      scale: 0.96 1.04;
    }
  }
  @keyframes ring-in {
    from {
      scale: 1.4;
      opacity: 0;
    }
  }
  :global(:root[data-calm]) .landed,
  :global(:root[data-calm]) .marker::before {
    animation: none;
  }
</style>
