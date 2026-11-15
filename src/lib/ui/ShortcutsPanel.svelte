<script lang="ts">
  import { tip } from "./tips.svelte";
  import { Search, X } from "@lucide/svelte";
  import { actions, formatKeys } from "../actions.svelte";
  import { ui } from "../app.svelte";
  import { isMac } from "../platform";
  import { settings } from "../settings.svelte";

  /**
   * Every action with a shortcut, from the registry, grouped. An action with keys that isn't in a
   * group below still shows up, under "Other", so new shortcuts never go missing.
   */
  const GROUPS: [title: string, ids: string[]][] = [
    ["General", ["find", "undo", "redo", "selectAll", "deselect", "copy", "cut", "paste", "duplicate", "delete"]],
    ["Create", ["quickAdd", "addText", "addChecklist", "addFrame"]],
    ["Pins", ["jumpToPin", "nextPin", "prevPin", "pinView", "editPinTitle"]],
    ["Formatting text", ["formatBold", "formatItalic", "formatStrike", "formatCode", "formatLink", "formatParagraph", "formatH1", "formatH2", "formatH3", "formatBullets", "formatNumbers", "formatTasks", "formatQuote"]],
    ["Cards", ["editText", "editChecklist", "hideDone", "fontUp", "fontDown", "countUp", "countDown", "countUp10", "countDown10"]],
    ["Arrange", ["nudge", "nudgeFar", "nudgeFree", "alignLeft", "alignRight", "alignTop", "alignBottom", "alignHCenter", "alignVCenter", "distributeH", "distributeV", "normalizeWidth", "normalizeHeight", "normalizeSize", "frameSelection", "ungroup", "editFrameTitle", "selectContents", "toggleCollapse", "tidy", "rotate90", "front", "back", "lock", "unlock", "attachToParent", "detachFromParent"]],
    ["Links", ["linkNodes", "linkFromFirst", "linkInSequence", "editLinkLabel", "reverseLink"]],
    ["Media", ["togglePlay", "toggleLoop", "prevFrame", "nextFrame", "flipH", "flipV", "nativeSize"]],
    ["PDF", ["prevPage", "nextPage", "firstPage", "lastPage"]],
    ["Maps", ["editMap", "mapRoom", "mapBrush", "mapErase", "mapWall", "mapDiagonal", "mapDoor", "mapNumber", "mapText", "mapStamp", "mapPath", "mapExterior", "mapGrid", "exitMap"]],
    ["Palettes", ["pickColors", "renamePalette", "stopPicking"]],
    ["Drawing", ["draw", "editDrawing", "toolPen", "toolMarker", "toolEraser", "brushSmaller", "brushLarger", "exitDraw"]],
    ["View", ["showOutline", "showTasks", "showHistory", "frame", "zoomIn", "zoomOut", "resetZoom", "toggleChrome", "toggleMinimap", "toggleSound", "toggleCalm", "togglePerf", "openSettings", "showShortcuts"]],
    ["File", ["new", "open", "save", "saveAs", "exportNode"]],
  ];

  const mod = isMac ? "⌘" : "Ctrl";
  const alt = isMac ? "⌥" : "Alt";
  const shift = isMac ? "⇧" : "Shift";

  interface Row {
    label: string;
    keys: string[];
  }

  /**
   * Gestures and editing keys that aren't actions in the registry. Written by hand: update them
   * when the interaction changes.
   */
  const MANUAL: [title: string, rows: Row[]][] = $derived([
    [
      "Mouse",
      [
        { label: "Pan", keys: ["Space + drag", "Middle drag", settings.wheel === "pan" ? "Wheel" : `${shift} + wheel`] },
        { label: "Zoom", keys: [settings.wheel === "zoom" ? "Wheel" : `${mod} + wheel`, "Pinch"] },
        { label: "Add to selection", keys: [`${shift} + click`, `${mod} + click`] },
        { label: "Move without the grid", keys: [`${alt} + drag`] },
        { label: "Rotate in 15° steps", keys: [`${shift} + rotate`] },
        { label: "Scale from the center", keys: [`${alt} + corner`] },
        { label: "New text card", keys: ["Double-click canvas"] },
        { label: "Edit a card, play media, rename a pin, edit a label", keys: ["Double-click it"] },
        { label: "Count by 10 steps", keys: [`${shift} + click −/+`] },
      ],
    ],
    [
      "While drawing",
      [
        { label: "Straight line (snaps to 15°)", keys: [`${shift} + drag`] },
        { label: "Straight line without snapping", keys: [`${shift} + ${mod} + drag`] },
        { label: "Straight line on from the last stroke", keys: [`${shift} + click`] },
        { label: "Pan", keys: ["Space + drag", "Middle drag"] },
      ],
    ],
    [
      "Editing a checklist",
      [
        { label: "Set a due date while typing", keys: ["@today", "@fri", "@+3", "@12oct"] },
        { label: "New task", keys: [formatKeys("enter")] },
        { label: "Nest / un-nest", keys: ["Tab", `${shift} + Tab`] },
        { label: "Remove an empty task", keys: [formatKeys("backspace")] },
        { label: "Previous / next task", keys: ["↑", "↓"] },
        { label: "Check a task", keys: [formatKeys("mod+enter")] },
        { label: "Finish editing", keys: ["Esc"] },
      ],
    ],
    [
      "Table",
      [
        { label: "Move between cells", keys: ["↑ ↓ ← →", "Tab", `${shift} + Tab`] },
        { label: "Edit a cell", keys: [formatKeys("enter"), "F2", "Type"] },
        { label: "Change a status or tick a checkbox", keys: ["Click", "Space", formatKeys("enter")] },
        { label: "Choose a status", keys: ["Right-click"] },
        { label: "Clear a cell", keys: [formatKeys("delete")] },
        { label: "Leave the cell", keys: ["Esc"] },
      ],
    ],
    [
      "Editing text",
      [{ label: "Finish editing", keys: ["Esc", formatKeys("mod+enter")] }],
    ],
  ]);

  const rowOf = (id: string): Row | null => {
    const a = actions[id];
    if (!a?.keys?.length) return null;
    return { label: a.label, keys: a.keyLabel ? [a.keyLabel] : a.keys.map(formatKeys) };
  };

  const sections = $derived.by(() => {
    const listed = new Set(GROUPS.flatMap(([, ids]) => ids));
    const other = Object.keys(actions).filter((id) => !listed.has(id));
    const fromRegistry: [string, Row[]][] = [...GROUPS, ["Other", other] as [string, string[]]].map(([title, ids]) => [
      title,
      ids.map(rowOf).filter((r): r is Row => r !== null),
    ]);
    return [...fromRegistry, ...MANUAL];
  });

  let query = $state("");
  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return sections
      .map(([title, rows]) => [title, q ? rows.filter((r) => `${title} ${r.label} ${r.keys.join(" ")}`.toLowerCase().includes(q)) : rows] as const)
      .filter(([, rows]) => rows.length);
  });

  let panel = $state<HTMLElement>();

  function close(e: PointerEvent) {
    const target = e.target as HTMLElement;
    if (panel?.contains(target) || target.closest("[data-shortcuts-toggle]")) return;
    ui.shortcutsOpen = false;
  }

  function focus(el: HTMLInputElement) {
    el.focus({ preventScroll: true });
  }
</script>

<svelte:window
  onpointerdown={close}
  onkeydown={(e) => {
    if (e.key === "Escape") ui.shortcutsOpen = false;
  }}
/>

<section class="panel" bind:this={panel} aria-label="Keyboard shortcuts">
  <header>
    <h2>Keyboard shortcuts</h2>
    <label class="search">
      <Search size={14} strokeWidth={1.8} />
      <input bind:value={query} placeholder="Search" spellcheck="false" aria-label="Search shortcuts" {@attach focus} />
    </label>
    <button class="close" {@attach tip({ text: "Close", keys: formatKeys("escape") })} aria-label="Close" onclick={() => (ui.shortcutsOpen = false)}>
      <X size={15} strokeWidth={1.8} />
    </button>
  </header>

  <div class="columns">
    {#each shown as [title, rows] (title)}
      <div class="group">
        <h3>{title}</h3>
        {#each rows as row, i (i)}
          <div class="row">
            <span class="label">{row.label}</span>
            <span class="keys">
              <!-- Each "or" stays with the key after it when the keys wrap. -->
              {#each row.keys as k, j (j)}
                <span class="binding">{#if j > 0}<span class="or">or</span>{/if}<kbd>{k}</kbd></span>
              {/each}
            </span>
          </div>
        {/each}
      </div>
    {:else}
      <p class="empty">No shortcut matches “{query}”.</p>
    {/each}
  </div>
</section>

<style>
  .panel {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    width: min(880px, calc(100vw - 48px));
    max-height: calc(100vh - 120px);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    border-radius: calc(14px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 18px 60px var(--panel-shadow);
    font-size: 13px;
    color: var(--text);
    z-index: 95;
    animation: rise 220ms cubic-bezier(0.2, 0.9, 0.3, 1.15);
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 12px 10px 18px;
    border-bottom: 1px solid var(--panel-border);
  }
  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .search {
    flex: 1;
    max-width: 260px;
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 9px;
    border-radius: calc(8px * var(--round));
    background: var(--control-bg);
    color: var(--text-muted);
  }
  .search input {
    all: unset;
    flex: 1;
    min-width: 0;
    color: var(--text);
    user-select: text;
    -webkit-user-select: text;
  }
  .search input::placeholder {
    color: var(--text-muted);
  }
  .close {
    all: unset;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: calc(6px * var(--round));
    color: var(--text-muted);
    cursor: pointer;
  }
  .close:hover {
    background: var(--panel-hover);
    color: var(--text);
  }
  .columns {
    overflow-y: auto;
    padding: 6px 18px 16px;
    columns: 3 240px;
    column-gap: 28px;
  }
  .group {
    break-inside: avoid;
    padding-top: 8px;
  }
  h3 {
    margin: 6px 0 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    padding: 3px 0;
  }
  .label {
    min-width: 0;
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: baseline;
    gap: 4px;
    flex-shrink: 0;
    max-width: 60%;
  }
  .binding {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    white-space: nowrap;
  }
  .or {
    font-size: 11px;
    color: var(--text-muted);
  }
  kbd {
    font-family: inherit;
    font-size: 11.5px;
    padding: 1px 6px;
    border-radius: calc(5px * var(--round));
    background: var(--control-bg);
    border: 1px solid var(--panel-border);
    border-bottom-width: 2px;
    color: var(--text);
    white-space: nowrap;
  }
  .empty {
    margin: 16px 0;
    color: var(--text-muted);
  }
  @keyframes rise {
    from {
      opacity: 0;
      translate: -50% calc(-50% + 10px);
      scale: 0.98;
    }
  }
  :global(:root[data-calm]) .panel {
    animation-name: fade;
    animation-duration: 140ms;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
