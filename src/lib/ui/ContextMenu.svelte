<script lang="ts">
  import { ALargeSmall, AlignStartVertical, ArrowDownUp, Castle, Goal, Group, MoveRight, Scaling, Spline, Timer as TimerIcon, Clapperboard, Eye, FolderClock, HardDrive, Layers, LayoutDashboard, MapPin, SquarePlus, Stamp } from "@lucide/svelte";
  import { templateEntries } from "../frame/templates.svelte";
  import { openPath, selectedNodes, ui } from "../app.svelte";
  import { isSprite } from "../sprite/model";
  import { layerEntries, spriteMenu, tagEntries } from "../sprite/sprites.svelte";
  import { isTimer } from "../timer/model";
  import { timerEntries, timerUi } from "../timer/timers.svelte";
  import { pinData, pinLabel } from "../pin/model";
  import { jumpToPin, pins } from "../pin/pins.svelte";
  import { MAP_STYLES } from "../map/model";
  import { settings } from "../settings.svelte";
  import { storageSummary } from "../storage.svelte";
  import Menu, { type MenuEntry } from "./Menu.svelte";
  import { cellMenu, tableUi } from "../table/table.svelte";
  import { paletteUi, swatchMenu } from "../palette/palette.svelte";
  import { actions, available, runAction } from "../actions.svelte";

  /** A single selected sprite's tags and layers (empty, and so hidden, otherwise). */
  const theSprite = () => {
    const n = selectedNodes();
    return n.length === 1 && isSprite(n[0]) ? n[0].id : null;
  };
  const ANIMATION: MenuEntry = {
    label: "Animation",
    icon: Clapperboard,
    items: () => (theSprite() ? ["prevFrame", "nextFrame", "-", ...tagEntries(theSprite()!)] : []),
  };
  const LAYERS: MenuEntry = { label: "Layers", icon: Layers, items: () => (theSprite() ? layerEntries(theSprite()!) : []) };
  /** A single selected timer's lengths and modes. */
  const TIMER: MenuEntry = {
    label: "Timer",
    icon: TimerIcon,
    items: () => {
      const n = selectedNodes();
      return n.length === 1 && isTimer(n[0]) ? timerEntries(n[0].id) : [];
    },
  };
  const SORT: MenuEntry = { label: "Sort colors", icon: ArrowDownUp, items: () => ["sortHue", "sortLightness"] };
  const COUNTER: MenuEntry = { label: "Goal and step", icon: Goal, items: () => ["setGoal", "removeGoal", "counterStep"] };
  const ARROWS: MenuEntry = { label: "Arrows", icon: MoveRight, items: () => ["arrowNone", "arrowEnd", "arrowBoth"] };
  const MAP_STYLE: MenuEntry = { label: "Map style", icon: Castle, items: () => MAP_STYLES.map((s) => `mapStyle-${s.id}`) };
  const SHAPE: MenuEntry = { label: "Shape", icon: Spline, items: () => ["shapeCurve", "shapeStraight", "shapeElbow"] };

  /** Where and how big a node is (each item only when it applies). */
  const TRANSFORM: MenuEntry = {
    label: "Transform",
    icon: Scaling,
    items: () => ["rotate90", "flipH", "flipV", "-", "nativeSize", "resetTransform", "-", "normalizeHeight", "normalizeWidth", "normalizeSize"],
  };
  const TEXT_SIZE: MenuEntry = { label: "Text size", icon: ALargeSmall, items: () => ["fontUp", "fontDown", "resetTextSize", "fitTextWidth", "fixedHeight"] };
  const ARRANGE: MenuEntry = {
    label: "Arrange",
    icon: AlignStartVertical,
    items: () => ["front", "back", "-", "alignLeft", "alignHCenter", "alignRight", "-", "alignTop", "alignVCenter", "alignBottom", "-", "distributeH", "distributeV", "-", "tidy"],
  };
  /** Frames and parents: what a node belongs to. */
  const GROUP: MenuEntry = { label: "Group", icon: Group, items: () => ["frameSelection", "removeFromFrame", "-", "attachToParent", "detachFromParent"] };

  /**
   * The menu on a node (or a selection, or links). What only this kind of node does comes first,
   * then the clipboard, then the general commands in submenus, so a node's menu stays short.
   */
  const SELECTION: MenuEntry[] = [
    "editFrameTitle", "selectContents", "toggleCollapse", "toggleFit", "toggleTemplate", "ungroup", "-",
    "goToPin", "editPinTitle", "-",
    "editText", "editChecklist", "hideDone", "editDrawing", "editMap", MAP_STYLE, "renamePalette", "pickColors", "addSwatch", SORT, "-",
    "countUp", "countDown", "counterReset", COUNTER, "-",
    "togglePlay", "toggleLoop", ANIMATION, LAYERS, "editTimer", "renameTimer", "resetTimer", "lapTimer", TIMER, "-",
    "prevPage", "nextPage", "spreadPages", "-",
    "editLinkLabel", "linkNodes", "linkFromFirst", "linkInSequence", ARROWS, SHAPE, "reverseLink", "dashedLink", "autoSides", "-",
    "copy", "cut", "paste", "duplicate", "-",
    TRANSFORM, TEXT_SIZE, ARRANGE, GROUP, "-",
    "extractPalette", "frame", "replacePicture", "slotFit", "slotFill", "cropPicture", "slotOff", "reveal", "exportNode", "-",
    "lock", "unlock", "delete",
  ];

  const recent: MenuEntry = {
    label: "Open recent",
    icon: FolderClock,
    items: () => {
      if (!settings.recent.length) return [];
      return [
        ...settings.recent.map((path) => {
          const parts = path.split(/[\\/]/);
          return {
            label: parts.pop()!.replace(/\.patchwork$/, ""),
            hint: parts.pop(),
            title: path,
            run: () => void openPath(path),
          };
        }),
        "-",
        { label: "Clear list", run: () => (settings.recent = []) },
      ];
    },
  };

  const storage: MenuEntry = {
    label: "Storage",
    icon: HardDrive,
    items: () => [
      { note: storageSummary() },
      "-",
      "collectFiles", "packBoard", "unpackBoard", "relinkMissing", "-",
      "embedNew",
    ],
  };

  /** File commands: the board pill's menu, and the "Board" submenu on the canvas. */
  const BOARD: MenuEntry[] = ["new", "open", recent, "-", "save", "saveAs", "-", "relinkMissing", storage];

  /** Every pin to jump to, and pinning the view. */
  const PINS: MenuEntry = {
    label: "Pins",
    icon: MapPin,
    items: () => [
      ...pins.list.map((n) => {
        const d = pinData(n.data);
        return { label: pinLabel(d), hint: String(d.slot), run: () => jumpToPin(d.slot) };
      }),
      "-",
      "nextPin", "prevPin", "pinView",
    ],
  };

  /** The rest of what can be added (text, checklists and drawing sit at the top level). */
  const ADD: MenuEntry = {
    label: "Add",
    icon: SquarePlus,
    items: () => ["addCounter", "addTimer", "addTable", "addFrame", "addPalette", "addMap", "addPin"],
  };

  /** Fresh copies of the board's templates, at the spot the menu opened on (hidden without templates). */
  const TEMPLATES: MenuEntry = {
    label: "New from template",
    icon: Stamp,
    items: () => {
      // Read now: the menu closes (and its spot goes) before an entry runs.
      const at = ui.menu?.world;
      return templateEntries(at);
    },
  };

  /**
   * The quick-add menu (N): every kind of node, numbered 1–0 so a key adds one, at the spot the
   * menu opened on; then the board's templates.
   */
  const QUICK_ADD = ["addText", "addChecklist", "draw", "addTable", "addCounter", "addTimer", "addFrame", "addPalette", "addMap", "addPin"];
  function quickAdd(): MenuEntry[] {
    // Read now: the menu closes (and its spot goes) before an entry runs.
    const at = ui.menu?.world;
    const numbered = QUICK_ADD.filter(available).map((id, i): MenuEntry => {
      const key = String((i + 1) % 10);
      const label = actions[id].label.replace(/^Add (\w)/, (_, c: string) => c.toUpperCase());
      return { label, icon: actions[id].icon, hint: key, key, run: () => runAction(id, { at }) };
    });
    return [...numbered, "-", TEMPLATES];
  }

  /** Panels and what's shown, then how the app feels. */
  const VIEW: MenuEntry = {
    label: "View",
    icon: Eye,
    items: () => ["showOutline", "showTasks", "showHistory", "-", "toggleMinimap", "toggleChrome", "-", "toggleSound", "toggleCalm"],
  };

  const CANVAS: MenuEntry[] = [
    "paste", "-",
    "addText", "addChecklist", "draw", ADD, TEMPLATES, "-",
    "selectAll", "find", "frame", PINS, "-",
    "undo", "redo", "-",
    { label: "Board", icon: LayoutDashboard, items: () => BOARD },
    VIEW,
    "openSettings", "showShortcuts",
  ];

  const entries = $derived(
    ui.menu?.target === "selection"
      ? SELECTION
      : ui.menu?.target === "board"
        ? [...BOARD, "-", "openSettings"]
        : ui.menu?.target === "table" && tableUi.cell
          ? cellMenu(tableUi.cell)
          : ui.menu?.target === "swatch" && paletteUi.swatch
            ? swatchMenu(paletteUi.swatch)
            : ui.menu?.target === "sprite"
              ? spriteMenu()
              : ui.menu?.target === "timer" && timerUi.menu
                ? timerEntries(timerUi.menu)
                : ui.menu?.target === "templates"
                  ? templateEntries()
                  : ui.menu?.target === "add"
                    ? quickAdd()
                    : CANVAS,
  );

  let host = $state<HTMLDivElement>();

  function close(e: PointerEvent) {
    if (ui.menu && !host?.contains(e.target as Node)) ui.menu = null;
  }
</script>

<svelte:window onpointerdown={close} onblur={() => (ui.menu = null)} onresize={() => (ui.menu = null)} />

{#if ui.menu}
  {#key ui.menu}
    <div bind:this={host} class="host">
      <Menu {entries} x={ui.menu.x} y={ui.menu.y} ctx={{ at: ui.menu.world }} onclose={() => (ui.menu = null)} />
    </div>
  {/key}
{/if}

<style>
  .host {
    display: contents;
  }
</style>
