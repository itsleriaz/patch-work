<script lang="ts">
  import { Check, Pipette } from "@lucide/svelte";
  import { formatKeys } from "../actions.svelte";
  import { paletteUi, stopPicking } from "../palette/palette.svelte";
  import { luminance } from "../palette/model";

  /**
   * The eyedropper's screen-space layer: a magnifier under the pointer showing the pixels around it
   * (the picture itself as a pixelated background, no canvas) with the color and its hex, and a
   * hint with Done at the top.
   */

  /** Magnifier size (px) and how many picture pixels across it shows. */
  const SIZE = 132;
  const ACROSS = 11;

  const l = $derived(paletteUi.loupe);
  const cell = SIZE / ACROSS;
</script>

<div class="hint" role="status">
  <Pipette size={14} strokeWidth={2} />
  <span>Click a picture to add its color</span>
  <kbd>{formatKeys("escape")}</kbd>
  <button onclick={stopPicking}><Check size={14} strokeWidth={2.2} />Done</button>
</div>

{#if l}
  <div class="loupe" style:left="{l.x}px" style:top="{l.y}px">
    <div
      class="pixels"
      style:width="{SIZE}px"
      style:height="{SIZE}px"
      style:background-image="url({l.url})"
      style:background-size="{l.w * cell}px {l.h * cell}px"
      style:background-position="{SIZE / 2 - (l.px + 0.5) * cell}px {SIZE / 2 - (l.py + 0.5) * cell}px"
    >
      <span class="target" style:width="{cell}px" style:height="{cell}px"></span>
    </div>
    <div class="label" style:background={l.hex} class:dark={luminance(l.hex) < 0.35}>{l.hex}</div>
  </div>
{/if}

<style>
  .hint {
    position: absolute;
    top: 60px;
    left: 50%;
    translate: -50% 0;
    z-index: 85;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 4px 4px 12px;
    border-radius: calc(12px * var(--round));
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    backdrop-filter: blur(12px);
    box-shadow: 0 6px 24px var(--panel-shadow);
    font-size: 13px;
    color: var(--text);
    white-space: nowrap;
  }
  kbd {
    font-family: inherit;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: calc(5px * var(--round));
    background: var(--control-bg);
    border: 1px solid var(--panel-border);
    color: var(--text-muted);
  }
  button {
    all: unset;
    display: flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 10px 0 8px;
    border-radius: calc(8px * var(--round));
    font-weight: 600;
    color: var(--accent);
    cursor: pointer;
  }
  button:hover {
    background: var(--panel-hover);
  }
  /* Beside the pointer, not under it, so the pixel being picked stays visible. */
  .loupe {
    position: absolute;
    translate: 18px 18px;
    pointer-events: none;
    z-index: 80;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .pixels {
    position: relative;
    border-radius: 50%;
    background-repeat: no-repeat;
    background-color: var(--canvas-bg);
    image-rendering: pixelated;
    border: 3px solid var(--panel-solid);
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.25),
      0 8px 24px rgb(0 0 0 / 0.3);
  }
  .target {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    box-sizing: border-box;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.6);
  }
  .label {
    padding: 2px 8px;
    border-radius: calc(6px * var(--round));
    font-family: ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", monospace;
    font-size: 12px;
    font-weight: 600;
    color: #111;
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.2),
      0 4px 12px rgb(0 0 0 / 0.25);
  }
  .label.dark {
    color: #fff;
  }
</style>
