import type { LinkArrow, LinkShape, TextAlign, TextColor } from "./doc/types";
import type { InkColor } from "./drawing/model";
import { isMac } from "./platform";
import { TEXT_COLORS } from "./text/palette";

/**
 * App preferences. These belong to the user, not the board, so they live in localStorage
 * and never go through history.
 *
 * Adding a setting: a field with its default in `Settings`, plus an entry in `SETTINGS` if it
 * should appear in the settings panel. Quick toggles can also become actions (see `toggleSound`).
 */
const KEY = "patchwork.settings";
/** Bumped when a stored preference needs changing on load (see `load`). */
const VERSION = 2;
const MAX_RECENT = 8;

export type Theme = "system" | "dark" | "light";
export type GridStyle = "dots" | "lines" | "none";
export type WheelMode = "zoom" | "pan";
export type Corners = "sharp" | "slight" | "round";

/** Accent colors (Everforest-leaning), one per theme: deeper on light backgrounds for contrast. */
export const ACCENTS = {
  blue: { dark: "#80a8cc", light: "#3f7fb5" },
  violet: { dark: "#a993d1", light: "#7d62b0" },
  pink: { dark: "#d699b6", light: "#b5598a" },
  orange: { dark: "#e69875", light: "#c0643a" },
  green: { dark: "#83c092", light: "#3f8f5f" },
  teal: { dark: "#7fbbb3", light: "#35867e" },
} as const;
export type Accent = keyof typeof ACCENTS;

/** Grid colors: the theme's text color (neutral), the accent, or one of the named colors (app.css). */
export const GRID_COLORS = {
  neutral: "var(--text)",
  accent: "var(--accent)",
  red: "var(--c-red)",
  orange: "var(--c-orange)",
  yellow: "var(--c-yellow)",
  green: "var(--c-green)",
  blue: "var(--c-blue)",
  purple: "var(--c-purple)",
} as const;
export type GridColor = keyof typeof GRID_COLORS;

/** Multiplies every corner radius in the app (`--round`). */
const CORNERS: Record<Corners, number> = { sharp: 0, slight: 0.5, round: 1 };

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

class Settings {
  // appearance
  theme = $state<Theme>("system");
  accent = $state<Accent>("blue");
  grid = $state<GridStyle>("dots");
  gridColor = $state<GridColor>("neutral");
  /** How much of the grid color is mixed into the canvas, 0–1. */
  gridStrength = $state(0.12);
  corners = $state<Corners>("round");
  // canvas
  /** What the plain mouse wheel does; the other needs Shift (pan) or Ctrl (zoom). */
  wheel = $state<WheelMode>(isMac ? "pan" : "zoom");
  snap = $state(true);
  gridSize = $state(20);
  /** World units between nodes that align stacks or distribute lines up. */
  arrangeGap = $state(10);
  /** Show images with hard pixels once they're drawn larger than their actual size. */
  pixelated = $state(false);
  /** Collapsed frames show a small picture of what's inside them. */
  framePreviews = $state(true);
  // new links (written into each link when it is created)
  linkShape = $state<LinkShape>("curve");
  linkArrow = $state<LinkArrow>("end");
  // new text cards
  textColor = $state<TextColor>("none");
  /** A new text card's font size (world units) and alignment. */
  textSize = $state(20);
  textAlign = $state<TextAlign>("left");
  /** How big pictures, videos and PDFs come in, as a multiple of `textSize` (see `importMaxSide`). */
  importSize = $state<"small" | "medium" | "large" | "native">("medium");
  // the export dialog's last choices
  exportFormat = $state<"png" | "svg">("png");
  exportScale = $state(2);
  exportTheme = $state<"light" | "dark">("light");
  exportBackground = $state<"none" | "card" | "white">("none");
  exportGrid = $state(true);
  spriteExport = $state<"png" | "sheet" | "gif">("gif");
  spriteScale = $state(4);
  spriteBackground = $state<"none" | "white">("none");
  tableExport = $state<"csv" | "md">("csv");
  paletteExport = $state<"gpl" | "ase" | "hex" | "png">("gpl");
  // drawing (the draw bar's last choices)
  inkTool = $state<"pen" | "marker" | "eraser">("pen");
  /** A named ink, or a "#RRGGBB" picked from a palette on the board. */
  inkColor = $state<InkColor>("red");
  /** Brush sizes, as an index into `SIZES` (drawing/model.ts): small, medium, large. */
  penSize = $state(1);
  markerSize = $state(1);
  eraserSize = $state(1);
  /** Map editing paints full cells or half cells. */
  mapGrid = $state<"full" | "half">("full");
  /** The stamp the map's Stamp tool places. */
  mapStamp = $state("stairs");
  /** How new overlay paths on maps look. */
  mapPathStyle = $state<"dashed" | "dotted" | "footprints">("dashed");
  mapPathColor = $state<"ink" | "red">("red");
  /** The map's Exterior tool: what it paints, and its brush size (0–2). */
  mapGround = $state<"dirt" | "grass" | "water" | "road">("grass");
  mapGroundSize = $state(1);
  // feel
  sound = $state(true);
  /** Master volume, 0–1. */
  volume = $state(0.6);
  /** Thrown pans glide on, wheel zoom eases. Off in calm mode too. */
  smoothCamera = $state(true);
  /** The overview of the board in the bottom-right corner. */
  minimap = $state(true);
  /** How many folders down "Find missing files" looks (0: no limit). */
  relinkDepth = $state(0);
  /** Calm mode: no playful motion (lift, tilt, pops, wobbles). Functional animation stays. */
  calm = $state(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  // advanced
  /** Performance overlay (F3). */
  perf = $state(false);

  /** The settings dialog's open page (remembered, not shown there). */
  settingsPage = $state<SettingsPage>("appearance");

  // the side panel (remembered, not shown in the settings panel)
  panelTab = $state<"outline" | "tasks" | "history">("outline");
  /** The Tasks tab: grouping and which tasks show. */
  tasksGroup = $state<"due" | "checklist">("due");
  tasksFilter = $state<"open" | "all" | "done">("open");
  /** The Tasks tab as a grouped list or a month calendar. */
  tasksView = $state<"list" | "calendar">("list");
  /** How the outliner orders its rows. */
  outlineSort = $state<"stacking" | "newest" | "position" | "kind">("stacking");
  /** CSS px. */
  panelWidth = $state(360);

  // find on the board
  /** The order matches are stepped through: nearest to the view first, reading order, or the outliner's. */
  findOrder = $state<"nearest" | "reading" | "outline">("nearest");
  findCase = $state(false);
  findWord = $state(false);
  /** Show every match in a list under the find bar (else just the current one). */
  findList = $state(true);

  /** Boards with a file save themselves a few seconds after changes stop. */
  autoSave = $state(true);

  /** Recently opened or saved boards, newest first. */
  recent = $state<string[]>([]);

  #systemDark = $state(systemDark.matches);
  /** The theme in effect, with "system" resolved. */
  resolvedTheme = $derived(this.theme === "system" ? (this.#systemDark ? "dark" : "light") : this.theme);

  #defaults: Record<string, unknown>;

  constructor() {
    this.#defaults = this.#values();
    this.#apply(load());

    systemDark.addEventListener("change", (e) => (this.#systemDark = e.matches));

    $effect.root(() => {
      $effect(() => {
        const values = this.#values();
        try {
          localStorage.setItem(KEY, JSON.stringify({ ...values, version: VERSION }));
        } catch {
          // Storage can be unavailable; preferences then last for the session.
        }
      });
      // CSS keys themes, accent and calm-mode rules off the root element.
      $effect(() => {
        const root = document.documentElement;
        root.dataset.theme = this.resolvedTheme;
        root.style.setProperty("--accent-base", (ACCENTS[this.accent] ?? ACCENTS.blue)[this.resolvedTheme]);
        root.style.setProperty("--grid-base", GRID_COLORS[this.gridColor] ?? GRID_COLORS.neutral);
        root.style.setProperty("--grid-strength", `${Math.round(this.gridStrength * 100)}%`);
        root.style.setProperty("--round", String(CORNERS[this.corners] ?? 1));
        root.toggleAttribute("data-calm", this.calm);
      });
    });
  }

  /** Restores every preference except the recent list. */
  reset() {
    this.#apply({ ...this.#defaults, recent: this.recent });
  }

  /** Remembers a board in the recent list. */
  addRecent(path: string) {
    this.recent = [path, ...this.recent.filter((p) => p !== path)].slice(0, MAX_RECENT);
  }

  forgetRecent(path: string) {
    this.recent = this.recent.filter((p) => p !== path);
  }

  #values(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of PERSISTED) out[key] = $state.snapshot(this[key] as unknown);
    return out;
  }

  /** Takes values whose type matches the default; ignores anything stale or foreign. */
  #apply(values: Record<string, unknown>) {
    for (const key of PERSISTED) {
      const v = values[key];
      if (v !== undefined && typeof v === typeof this[key] && Array.isArray(v) === Array.isArray(this[key])) {
        (this as Record<string, unknown>)[key] = v;
      }
    }
  }
}

const PERSISTED = [
  "theme", "accent", "grid", "gridColor", "gridStrength", "corners", "wheel", "snap", "gridSize", "arrangeGap", "pixelated", "framePreviews", "linkShape", "linkArrow", "textColor", "textSize", "textAlign", "importSize",
  "exportFormat", "exportScale", "exportTheme", "exportBackground", "exportGrid", "spriteExport", "spriteScale", "spriteBackground", "tableExport", "paletteExport",
  "inkTool", "inkColor", "penSize", "markerSize", "eraserSize", "mapGrid", "mapStamp", "mapPathStyle", "mapPathColor", "mapGround", "mapGroundSize",
  "sound", "smoothCamera", "minimap", "relinkDepth", "volume", "calm", "perf", "autoSave", "settingsPage", "panelTab", "panelWidth", "outlineSort", "tasksGroup", "tasksFilter", "tasksView", "findOrder", "findCase", "findWord", "findList", "recent",
] as const;

function load(): Record<string, unknown> {
  let stored: Record<string, unknown>;
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
  // Version 2 turned "Save automatically" on by default. Before it, every install stored the
  // old default (off) without anyone choosing it, so that value is dropped once.
  if (((stored.version as number) ?? 1) < 2) delete stored.autoSave;
  // The map's scatter brush is gone (2026-10-11).
  if (stored.mapGround === "scatter") delete stored.mapGround;
  return stored;
}

export const settings = new Settings();

/** A new text card's style: the "New text" preferences, written into the card (so changing them later restyles nothing). */
export const newTextStyle = () => ({ fontSize: settings.textSize, align: settings.textAlign, color: settings.textColor });

// ---------------------------------------------------------------- panel definitions

type Key = (typeof PERSISTED)[number];

export type SettingControl =
  | { kind: "toggle" }
  | { kind: "choice"; options: [value: string | number, label: string][] }
  | { kind: "slider"; min: number; max: number; step: number; format: (v: number) => string }
  | { kind: "swatches"; options: () => Swatch[] };

export interface Swatch {
  value: string;
  /** Any CSS color, including var(). */
  color: string;
  label: string;
  /** Drawn crossed out (e.g. "No card"). */
  none?: boolean;
}

/** The settings dialog's pages, in sidebar order. "About" holds credits, not settings. */
export type SettingsPage = "appearance" | "canvas" | "feel" | "new" | "files" | "advanced" | "about";

export const SETTINGS_PAGES: [SettingsPage, string][] = [
  ["appearance", "Appearance"],
  ["canvas", "Canvas"],
  ["feel", "Feel"],
  ["new", "New items"],
  ["files", "Files"],
  ["advanced", "Advanced"],
  ["about", "About"],
];

export interface SettingDef {
  key: Key;
  label: string;
  page: SettingsPage;
  /** A subheading within the page; rows with the same group sit together. */
  group?: string;
  hint?: string;
  /** Other words search should find it by ("dark" for Theme). */
  keywords?: string;
  control: SettingControl;
  /** Hidden while this returns false (e.g. volume while sound is off). */
  when?: () => boolean;
}

/** What the settings dialog shows, in order. Groups are listed by first appearance within a page. */
export const SETTINGS: SettingDef[] = [
  { key: "theme", page: "appearance", label: "Theme", keywords: "dark light mode", control: { kind: "choice", options: [["system", "Auto"], ["dark", "Dark"], ["light", "Light"]] } },
  { key: "accent", page: "appearance", label: "Accent", keywords: "color highlight", control: { kind: "swatches", options: () => Object.entries(ACCENTS).map(([value, c]) => ({ value, color: c[settings.resolvedTheme], label: value })) } },
  { key: "corners", page: "appearance", label: "Corners", keywords: "rounded radius", control: { kind: "choice", options: [["sharp", "Sharp"], ["slight", "Slight"], ["round", "Round"]] } },

  { key: "grid", page: "appearance", group: "Grid", label: "Style", keywords: "dots lines background", control: { kind: "choice", options: [["dots", "Dots"], ["lines", "Lines"], ["none", "None"]] } },
  { key: "gridColor", page: "appearance", group: "Grid", label: "Color", when: () => settings.grid !== "none", control: { kind: "swatches", options: () => Object.entries(GRID_COLORS).map(([value, color]) => ({ value, color, label: value })) } },
  { key: "gridStrength", page: "appearance", group: "Grid", label: "Strength", keywords: "opacity contrast", when: () => settings.grid !== "none", control: { kind: "slider", min: 0.04, max: 0.4, step: 0.01, format: (v) => `${Math.round(v * 100)}%` } },

  { key: "wheel", page: "canvas", group: "Moving around", label: "Mouse wheel", keywords: "scroll zoom pan trackpad", hint: "The other one needs Shift (pan) or Ctrl (zoom).", control: { kind: "choice", options: [["zoom", "Zooms"], ["pan", "Pans"]] } },
  { key: "minimap", page: "canvas", group: "Moving around", label: "Minimap", keywords: "overview", hint: "An overview of the board in the corner. Click or drag in it to move the view; scroll over it to zoom.", control: { kind: "toggle" } },

  { key: "snap", page: "canvas", group: "Arranging", label: "Snap to grid", hint: "Hold Alt while dragging to do the opposite.", control: { kind: "toggle" } },
  { key: "gridSize", page: "canvas", group: "Arranging", label: "Grid size", control: { kind: "choice", options: [[10, "10"], [20, "20"], [40, "40"]] } },
  { key: "arrangeGap", page: "canvas", group: "Arranging", label: "Arrange spacing", keywords: "align distribute gap", hint: "Between nodes stacked by align or lined up by distribute.", control: { kind: "choice", options: [[0, "None"], [10, "10"], [20, "20"], [40, "40"]] } },

  { key: "framePreviews", page: "canvas", group: "Frames", label: "Previews on collapsed frames", keywords: "thumbnail collapse", hint: "A collapsed frame shows a small picture of what's inside it.", control: { kind: "toggle" } },
  { key: "pixelated", page: "canvas", group: "Images", label: "Sharp pixels", keywords: "pixel art nearest smoothing", hint: "No smoothing when an image is shown larger than its real size.", control: { kind: "toggle" } },

  { key: "findOrder", page: "canvas", group: "Find on the board", label: "Find order", keywords: "search", hint: "How Find on the board steps through matches. Outline follows the outliner's sort.", control: { kind: "choice", options: [["nearest", "Nearest"], ["reading", "Reading"], ["outline", "Outline"]] } },

  { key: "calm", page: "feel", group: "Motion", label: "Calm mode", keywords: "reduce motion animation", hint: "No bouncing, leaning or popping.", control: { kind: "toggle" } },
  { key: "smoothCamera", page: "feel", group: "Motion", label: "Smooth camera", keywords: "momentum inertia ease", hint: "A thrown pan glides on; wheel zoom eases. Off in calm mode.", control: { kind: "toggle" } },

  { key: "sound", page: "feel", group: "Sound", label: "Sound effects", keywords: "audio", control: { kind: "toggle" } },
  { key: "volume", page: "feel", group: "Sound", label: "Volume", keywords: "loud", when: () => settings.sound, control: { kind: "slider", min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` } },

  { key: "textColor", page: "new", group: "Text cards", label: "Card color", hint: "Existing cards keep theirs.", control: { kind: "swatches", options: () => Object.entries(TEXT_COLORS).map(([value, c]) => ({ value, color: c.bg, label: c.label, none: value === "none" })) } },
  { key: "textSize", page: "new", group: "Text cards", label: "Size", keywords: "font", hint: "Corner handles and Larger/Smaller text change it per card.", control: { kind: "choice", options: [[14, "14"], [20, "20"], [28, "28"], [40, "40"]] } },
  { key: "textAlign", page: "new", group: "Text cards", label: "Alignment", control: { kind: "choice", options: [["left", "Left"], ["center", "Center"], ["right", "Right"]] } },

  { key: "importSize", page: "new", group: "Pictures, videos and PDFs", label: "Size", keywords: "import drop paste image scale native", hint: "How big they come in, in step with the text size above (Medium is about two cards wide). Smaller files keep their own size.", control: { kind: "choice", options: [["small", "Small"], ["medium", "Medium"], ["large", "Large"], ["native", "Native size"]] } },

  { key: "linkShape", page: "new", group: "Links", label: "Shape", keywords: "curve straight elbow", hint: "Existing links keep theirs.", control: { kind: "choice", options: [["curve", "Curved"], ["straight", "Straight"], ["elbow", "Elbow"]] } },
  { key: "linkArrow", page: "new", group: "Links", label: "Arrows", keywords: "arrowhead", control: { kind: "choice", options: [["none", "None"], ["end", "End"], ["both", "Both"]] } },

  { key: "autoSave", page: "files", group: "Saving", label: "Save automatically", keywords: "autosave recovery", hint: "Boards with a file save themselves a few seconds after you stop changing things. Unsaved changes are always kept in a recovery copy, offered back after a crash.", control: { kind: "toggle" } },

  { key: "relinkDepth", page: "files", group: "Missing files", label: "Search depth", keywords: "relink folders", hint: "How many folders deep \u201cFind missing files\u201d looks inside the folder you pick. A limit keeps it quick when you pick a big folder, like your home folder.", control: { kind: "choice", options: [[0, "Any depth"], [2, "2"], [4, "4"], [8, "8"]] } },

  { key: "perf", page: "advanced", label: "Performance overlay", keywords: "fps frame meter debug", hint: "Frame times and scene counts in the corner. F3 turns it on and off.", control: { kind: "toggle" } },
];
