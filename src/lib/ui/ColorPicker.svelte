<script lang="ts">
  import { scale } from "svelte/transition";
  import { doc } from "../app.svelte";
  import { play } from "../juice/sound";
  import { fromHsv, normalizeHex, paletteData, toHsv, type Hsv } from "../palette/model";
  import { addColor, paletteUi, setColor } from "../palette/palette.svelte";

  /**
   * The color picker for a palette's swatch (or a new one), in screen space: a saturation/value
   * square, a hue strip and a hex field, with the old color next to the new one. Enter, Done or a
   * click outside keeps the color; Esc cancels. Nothing changes on the board until then, so the
   * whole edit is one undo step.
   */

  const open = $derived(paletteUi.picker);
  const swatch = $derived.by(() => {
    const p = open;
    return p?.colorId ? paletteData(doc.nodes[p.nodeId]?.data).colors.find((c) => c.id === p.colorId) : undefined;
  });
  /** The color it started from: the swatch's, or for a new color the palette's last one (else a soft blue). */
  const start = $derived.by(() => {
    if (!open) return "#5B8DEF";
    if (swatch) return swatch.hex;
    const colors = paletteData(doc.nodes[open.nodeId]?.data).colors;
    return colors[colors.length - 1]?.hex ?? "#5B8DEF";
  });

  let hsv = $state<Hsv>([0, 0, 0]);
  let typed = $state("");
  // A new target resets the picker to its color.
  $effect(() => {
    void open;
    hsv = toHsv(start);
    typed = start;
  });
  const hex = $derived(fromHsv(hsv));
  const pure = $derived(fromHsv([hsv[0], 1, 1]));

  function close(keep: boolean) {
    const p = paletteUi.picker;
    if (!p) return;
    paletteUi.picker = null;
    if (!keep) return play("tap", { volume: 0.3, pitch: 0.85 });
    if (p.colorId) setColor(p.nodeId, p.colorId, hex);
    else addColor(p.nodeId, hex);
  }

  /** Dragging inside the square or the strip: `set` gets the pointer as fractions (0–1) of the element. */
  function drag(set: (u: number, v: number) => void) {
    return (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      const at = (ev: PointerEvent) => {
        const r = el.getBoundingClientRect();
        set(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
        typed = fromHsv(hsv);
      };
      at(e);
      const move = (ev: PointerEvent) => at(ev);
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    };
  }

  const dragSv = drag((u, v) => (hsv = [hsv[0], u, 1 - v]));
  // The hue strip runs left to right; a grey keeps some saturation so moving the hue shows.
  const dragHue = drag((u) => (hsv = [u * 359.9, hsv[1] || 0.6, hsv[2] || 0.8]));

  function type(value: string) {
    typed = value;
    const h = normalizeHex(value);
    if (h) hsv = toHsv(h);
  }

  // Inside the window, below its anchor (or above when there's no room).
  const W = 232, H = 268;
  const left = $derived(open ? Math.max(8, Math.min(open.x, window.innerWidth - W - 8)) : 0);
  const top = $derived(open ? (open.y + H > window.innerHeight - 8 ? Math.max(8, open.y - H - 60) : open.y) : 0);

  let host = $state<HTMLDivElement>();

  function focusField(el: HTMLInputElement) {
    el.focus();
    el.select();
  }
</script>

<svelte:window
  onpointerdown={(e) => open && !host?.contains(e.target as Node) && close(true)}
  onkeydowncapture={(e) => {
    if (!open || (e.key !== "Escape" && e.key !== "Enter")) return;
    // Not the board's Enter (rename) or Esc (deselect) too: they listen on the window as well.
    e.preventDefault();
    e.stopImmediatePropagation();
    close(e.key === "Enter");
  }}
/>

{#if open}
  <div
    class="picker"
    role="dialog"
    aria-label={open.colorId ? "Edit color" : "Add color"}
    bind:this={host}
    style:left="{left}px"
    style:top="{top}px"
    style:width="{W}px"
    transition:scale={{ duration: 130, start: 0.94 }}
  >
    <div class="sv" style:--pure={pure} onpointerdown={dragSv} role="slider" aria-label="Saturation and brightness" aria-valuenow={Math.round(hsv[1] * 100)} tabindex="-1">
      <span class="knob" style:left="{hsv[1] * 100}%" style:top="{(1 - hsv[2]) * 100}%" style:background={hex}></span>
    </div>
    <div class="hue" onpointerdown={dragHue} role="slider" aria-label="Hue" aria-valuenow={Math.round(hsv[0])} tabindex="-1">
      <span class="knob" style:left="{(hsv[0] / 360) * 100}%" style:background={pure}></span>
    </div>
    <div class="row">
      <span class="compare" aria-hidden="true">
        {#if swatch}<span style:background={swatch.hex}></span>{/if}
        <span style:background={hex}></span>
      </span>
      <input
        class="field"
        class:bad={!normalizeHex(typed)}
        value={typed}
        spellcheck="false"
        aria-label="Hex code"
        maxlength="7"
        oninput={(e) => type(e.currentTarget.value)}
        onblur={() => (typed = hex)}
        {@attach focusField}
      />
      <button class="done" onclick={() => close(true)}>{open.colorId ? "Done" : "Add"}</button>
    </div>
  </div>
{/if}

<style>
  .picker {
    position: fixed;
    z-index: 120;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-sizing: border-box;
    padding: 10px;
    border-radius: calc(12px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 12px 36px var(--panel-shadow);
    color: var(--text);
    font-size: 12.5px;
    user-select: none;
    transform-origin: top left;
  }
  .sv {
    position: relative;
    height: 150px;
    border-radius: calc(8px * var(--round));
    background:
      linear-gradient(to top, #000, transparent),
      linear-gradient(to right, #fff, var(--pure));
    cursor: crosshair;
    touch-action: none;
    outline: none;
  }
  .hue {
    position: relative;
    height: 12px;
    border-radius: 6px;
    background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
    cursor: pointer;
    touch-action: none;
    outline: none;
  }
  .knob {
    position: absolute;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35), 0 2px 6px rgb(0 0 0 / 0.25);
    translate: -50% -50%;
    pointer-events: none;
  }
  .hue .knob {
    top: 50%;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .compare {
    display: flex;
    flex: none;
    width: 36px;
    height: 26px;
    border-radius: calc(6px * var(--round));
    overflow: hidden;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
  }
  .compare span {
    flex: 1;
  }
  .field {
    all: unset;
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0 8px;
    box-sizing: border-box;
    border-radius: calc(6px * var(--round));
    background: var(--control-bg);
    border: 1px solid var(--panel-border);
    font-family: ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", monospace;
    font-size: 12px;
    text-transform: uppercase;
    user-select: text;
    -webkit-user-select: text;
  }
  .field:focus {
    border-color: var(--accent);
  }
  .field.bad {
    border-color: var(--danger);
  }
  .done {
    all: unset;
    flex: none;
    height: 26px;
    padding: 0 12px;
    border-radius: calc(6px * var(--round));
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    cursor: pointer;
  }
  .done:hover {
    filter: brightness(1.08);
  }
</style>
