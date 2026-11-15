<script lang="ts">
  import { scale } from "svelte/transition";
  import { AlignStartVertical, Ellipsis, Heading } from "@lucide/svelte";
  import { actions, actionTip, available, runAction, setLinkColor, setTextColor } from "../actions.svelte";
  import { tip } from "./tips.svelte";
  import { selectedLinks, selectedNodes, ui } from "../app.svelte";
  import { play } from "../juice/sound";
  import type { LinkColor, TextColor } from "../doc/types";
  import { LINK_COLORS, linkData } from "../links/palette";
  import { setFrameColor } from "../frame/frames.svelte";
  import { FRAME_COLORS, frameData, type FrameColor } from "../frame/model";
  import { PIN_COLORS, pinData, type PinColor } from "../pin/model";
  import { setPinColor } from "../pin/pins.svelte";
  import { TEXT_COLORS, textData } from "../text/palette";
  import { fmt, formatting } from "../text/format.svelte";
  import { drawUi } from "../drawing/draw.svelte";
  import { mapUi } from "../map/map.svelte";

  /**
   * A button opening more actions, shown when any of them applies: a grid of icons (rows), or a
   * list with labels (`list`) for actions that don't read from their icon alone.
   */
  interface Popover {
    id: string;
    label: string;
    icon: typeof AlignStartVertical;
    rows: string[][];
    list?: boolean;
  }

  const HEADINGS: Popover = {
    id: "headings",
    label: "Text style",
    icon: Heading,
    rows: [["formatParagraph", "formatH1", "formatH2", "formatH3"]],
  };

  const ARRANGE: Popover = {
    id: "arrange",
    label: "Arrange",
    icon: AlignStartVertical,
    rows: [
      ["alignLeft", "alignHCenter", "alignRight"],
      ["alignTop", "alignVCenter", "alignBottom"],
      ["distributeH", "distributeV", "tidy"],
      ["front", "back", "rotate90"],
    ],
  };

  /** The selection's less frequent actions (all also in the context menu, most with a shortcut). */
  const MORE: Popover = {
    id: "more",
    label: "More",
    icon: Ellipsis,
    rows: [["exportNode", "replacePicture", "slotFit", "slotFill", "cropPicture", "slotOff", "frameSelection", "removeFromFrame", "attachToParent", "detachFromParent", "lock", "unlock"]],
    list: true,
  };

  type Item = string | Popover;

  // Groups appear only when at least one of their actions (or their popovers') applies to the selection.
  // Adding to the board and undo/redo live in the create rail (CreateRail.svelte), so with nothing
  // selected the toolbar is gone.
  const groups: { id: string; items: Item[] }[] = [
    // Formatting while a text card is edited (the rich editor).
    { id: "format", items: ["formatBold", "formatItalic", "formatStrike", "formatCode", "formatLink", HEADINGS] },
    { id: "blocks", items: ["formatBullets", "formatNumbers", "formatTasks", "formatQuote", "formatClear"] },
    { id: "pdf", items: ["prevPage", "nextPage", "spreadPages"] },
    { id: "palette", items: ["renamePalette", "pickColors", "addSwatch"] },
    { id: "map", items: ["editMap"] },
    { id: "media", items: ["extractPalette", "togglePlay", "prevFrame", "nextFrame", "toggleLoop", "flipH", "flipV", "normalizeHeight", "normalizeWidth", "normalizeSize", "nativeSize", "resetTransform", "reveal"] },
    { id: "text", items: ["editText", "editChecklist", "hideDone", "fontDown", "fontUp", "resetTextSize", "fitTextWidth", "fixedHeight", "alignTextLeft", "alignTextCenter", "alignTextRight"] },
    { id: "frame", items: ["editFrameTitle", "selectContents", "toggleCollapse", "toggleFit", "toggleTemplate", "ungroup"] },
    { id: "pin", items: ["editPinTitle", "goToPin"] },
    { id: "timer", items: ["resetTimer", "lapTimer", "editTimer"] },
    { id: "counter", items: ["countDown", "countUp", "setGoal", "removeGoal", "counterStep", "counterReset"] },
    { id: "link", items: ["editLinkLabel", "arrowNone", "arrowEnd", "arrowBoth", "shapeCurve", "shapeStraight", "shapeElbow", "reverseLink", "dashedLink", "autoSides"] },
    { id: "multi", items: ["linkNodes", "linkFromFirst", "linkInSequence"] },
    { id: "selection", items: [ARRANGE, "duplicate", "delete", MORE] },
  ];

  /** While a text card is edited, the toolbar is about its text: formatting and the card's style. */
  const EDITING = new Set(["format", "blocks", "text"]);

  const shown = (item: Item) => (typeof item === "string" ? available(item) : popoverShown(item));

  // Draw mode and map editing put their own bar in the toolbar's place.
  const visibleGroups = $derived(
    drawUi.active || mapUi.editing ? [] : groups.filter((g) => (!formatting() || EDITING.has(g.id)) && (g.items.some(shown) || palette?.group === g.id)),
  );

  interface Swatch {
    key: string;
    color: string;
    label: string;
    /** Drawn crossed out: "no card". */
    none?: boolean;
  }

  /** The color popover: card colors for text-only selections, line colors for links. */
  const palette = $derived.by((): { group: string; title: string; current: string; swatches: Swatch[]; pick: (key: string) => void } | null => {
    const frameNodes = selectedNodes().filter((n) => n.kind === "frame");
    if (frameNodes.length && frameNodes.length === selectedNodes().length) {
      return {
        group: "frame",
        title: "Frame color",
        current: frameData(frameNodes[0].data).color,
        swatches: Object.entries(FRAME_COLORS).map(([key, c]) => ({ key, color: c.color, label: c.label })),
        pick: (key) => setFrameColor(key as FrameColor),
      };
    }
    const pinNodes = selectedNodes().filter((n) => n.kind === "pin");
    if (pinNodes.length && pinNodes.length === selectedNodes().length) {
      return {
        group: "pin",
        title: "Pin color",
        current: pinData(pinNodes[0].data).color,
        swatches: Object.entries(PIN_COLORS).map(([key, c]) => ({ key, color: c.color, label: c.label })),
        pick: (key) => setPinColor(key as PinColor),
      };
    }
    const links = selectedLinks();
    if (links.length) {
      return {
        group: "link",
        title: "Line color",
        current: linkData(links[0].data).color,
        swatches: Object.entries(LINK_COLORS).map(([key, c]) => ({ key, color: c.stroke, label: c.label })),
        pick: (key) => setLinkColor(key as LinkColor),
      };
    }
    const nodes = selectedNodes();
    if (!nodes.length || !nodes.every((n) => n.kind === "text")) return null;
    return {
      group: "text",
      title: "Card color",
      current: textData(nodes[0].data).color,
      swatches: Object.entries(TEXT_COLORS).map(([key, c]) => ({ key, color: c.bg, label: c.label, none: key === "none" })),
      pick: (key) => setTextColor(key as TextColor),
    };
  });
  const current = $derived(palette?.swatches.find((s) => s.key === palette.current));
  /** The open popover: "colors" (the color picker) or a popover's id. */
  let open = $state<string | null>(null);
  const colorsOpen = $derived(open === "colors");

  // A popover whose button went away (the selection changed) closes rather than reopening later.
  $effect(() => {
    if (open === "colors" && !palette) open = null;
    if (open && open !== "colors" && !visibleGroups.some((g) => g.items.some((it) => typeof it !== "string" && it.id === open && popoverShown(it)))) open = null;
  });

  function popoverShown(p: Popover) {
    return p.rows.some((row) => row.some((id) => available(id)));
  }

  function toggle(which: string) {
    open = open === which ? null : which;
    play("tap", { pitch: open ? 1.15 : 0.9 });
  }

  function pickColor(key: string) {
    palette?.pick(key);
    open = null;
  }
</script>

<!-- Centered in the window, but never over the board pill: the left column is at least as wide as
     the pill, so the toolbar moves right (and wraps, if it must) when the window is narrow. -->
<!-- Pressing a button doesn't take the focus: a text card being edited keeps its caret (and edit). -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="toolbar-row" onmousedown={(e) => (e.target as HTMLElement).closest("button") && e.preventDefault()}>
  {#if visibleGroups.length}
  <div class="toolbar" role="toolbar" aria-label="Tools" transition:scale={{ duration: 140, start: 0.92 }}>
    {#each visibleGroups as group, i (group.id)}
      {#if i > 0}<div class="sep" in:scale={{ duration: 140 }}></div>{/if}
      <div class="group" in:scale={{ duration: 160, start: 0.85 }}>
        {#each group.items as item (typeof item === "string" ? item : item.id)}
          {#if typeof item === "string"}
            {@const action = actions[item]}
            {#if available(item)}
              <button class:active={action.active?.()} {@attach tip(actionTip(item))} aria-label={action.label} onclick={() => runAction(item)}>
                {#if action.icon}<action.icon size={17} strokeWidth={1.8} />{/if}
              </button>
            {/if}
          {:else if popoverShown(item)}
            {@const p = item}
            <!-- Stays open while its actions are used, so several can be tried in a row. -->
            <div class="pop-host">
              <button
                class:has-popover={!p.list}
                class:active={open === p.id}
                class:open={open === p.id}
                {@attach tip(p.label)}
                aria-label={p.label}
                aria-expanded={open === p.id}
                onclick={() => toggle(p.id)}
              >
                <p.icon size={17} strokeWidth={1.8} />
              </button>
              {#if open === p.id}
                <div class="popover" class:grid={!p.list} class:list={p.list} role="menu" aria-label={p.label} transition:scale={{ duration: 140, start: 0.9 }}>
                  {#each p.rows as row, r (r)}
                    {#each row as id (id)}
                      {@const action = actions[id]}
                      {#if p.list}
                        {#if available(id)}
                          {@const keys = actionTip(id).keys}
                          <button class="row" role="menuitem" onclick={() => (runAction(id), (open = null))}>
                            {#if action.icon}<action.icon size={15} strokeWidth={1.8} />{/if}
                            <span>{action.label}</span>
                            {#if keys}<kbd>{keys}</kbd>{/if}
                          </button>
                        {/if}
                      {:else}
                        <button disabled={!available(id)} {@attach tip(actionTip(id))} aria-label={action.label} onclick={() => runAction(id)}>
                          {#if action.icon}<action.icon size={17} strokeWidth={1.8} />{/if}
                        </button>
                      {/if}
                    {/each}
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        {/each}
        {#if palette && group.id === palette.group}
          <div class="pop-host">
            <button
              class="swatch-button has-popover"
              class:open={open === "colors"}
              {@attach tip(palette.title)}
              aria-label={palette.title}
              onclick={() => toggle("colors")}
            >
              <span class="swatch" class:none={current?.none} style:background={current?.color}></span>
            </button>
            {#if colorsOpen}
              <div class="popover" transition:scale={{ duration: 140, start: 0.9 }}>
                {#each palette.swatches as s (s.key)}
                  <button
                    class="swatch"
                    class:none={s.none}
                    class:current={s.key === palette.current}
                    style:background={s.color}
                    {@attach tip(s.label)}
                    aria-label={s.label}
                    onclick={() => pickColor(s.key)}
                  ></button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
  {/if}
</div>

<svelte:window
  onpointerdown={(e) => open && !(e.target as HTMLElement).closest(".pop-host") && (open = null)}
  onkeydown={(e) => e.key === "Escape" && open && (open = null)}
/>

{#if ui.editing && !fmt.linking}
  <div class="hint" transition:scale={{ duration: 140, start: 0.9 }}>
    Editing · <kbd>Esc</kbd> to finish
  </div>
{/if}

<style>
  .toolbar-row {
    position: absolute;
    top: 12px;
    left: 0;
    right: 0;
    display: grid;
    grid-template-columns: minmax(calc(var(--pill-width, 0px) + 20px), 1fr) minmax(0, max-content) minmax(12px, 1fr);
    pointer-events: none;
  }
  .toolbar {
    grid-column: 2;
    position: relative;
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    border-radius: calc(12px * var(--round));
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    backdrop-filter: blur(12px);
    box-shadow: 0 6px 24px var(--panel-shadow);
    user-select: none;
    /* Its own width; it wraps only when the window is really too narrow. */
    width: max-content;
    max-width: 100%;
    box-sizing: border-box;
    flex-wrap: wrap;
    justify-content: center;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 1px;
  }
  .sep {
    width: 1px;
    height: 20px;
    background: var(--panel-border);
    margin: 0 2px;
  }
  button {
    all: unset;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: calc(8px * var(--round));
    color: var(--text);
    cursor: pointer;
    transition:
      background 100ms,
      scale 100ms;
  }
  button:hover:not(:disabled) {
    background: var(--panel-hover);
  }
  button:active:not(:disabled) {
    scale: 0.9;
  }
  button:disabled {
    opacity: 0.3;
    cursor: default;
  }
  button.active {
    background: var(--accent-wash);
    color: var(--accent);
  }
  /* Buttons that open a popover: a small wedge in the corner, like a tool flyout. */
  .has-popover {
    position: relative;
  }
  .has-popover::after {
    content: "";
    position: absolute;
    right: 3px;
    bottom: 3px;
    border-left: 4px solid transparent;
    border-bottom: 4px solid currentColor;
    opacity: 0.35;
    transition: opacity 120ms;
  }
  .has-popover:hover::after,
  .has-popover.open::after {
    opacity: 0.8;
  }
  .pop-host {
    position: relative;
  }
  .swatch {
    display: block;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 1.5px solid color-mix(in srgb, var(--text) 25%, transparent);
    box-sizing: border-box;
  }
  .swatch.none {
    background: linear-gradient(135deg, transparent 45%, var(--danger) 45% 55%, transparent 55%) !important;
  }
  .popover {
    position: absolute;
    top: 38px;
    left: 50%;
    translate: -50% 0;
    display: flex;
    gap: 6px;
    padding: 8px;
    border-radius: calc(10px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 8px 24px var(--panel-shadow);
  }
  .popover.grid {
    display: grid;
    grid-template-columns: repeat(3, 30px);
    gap: 2px;
    padding: 4px;
  }
  .popover.list {
    left: auto;
    right: 0;
    translate: none;
    flex-direction: column;
    gap: 1px;
    padding: 4px;
    min-width: 190px;
  }
  .popover .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: auto;
    height: 28px;
    padding: 0 8px;
    font-size: 13px;
    white-space: nowrap;
  }
  .popover .row span {
    flex: 1;
  }
  .popover .row kbd {
    padding: 0;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
  }
  .popover .swatch {
    width: 20px;
    height: 20px;
    cursor: pointer;
    transition: scale 100ms;
  }
  .popover .swatch:hover {
    scale: 1.15;
  }
  .popover .swatch.current {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .hint {
    position: absolute;
    top: 60px;
    left: 50%;
    translate: -50% 0;
    padding: 5px 10px;
    border-radius: calc(8px * var(--round));
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    font-size: 12px;
    color: var(--text-muted);
    pointer-events: none;
  }
  kbd {
    font-family: inherit;
    padding: 0 4px;
    border-radius: calc(4px * var(--round));
    background: var(--panel-hover);
    color: var(--text);
  }
</style>
