import type { CanvasNode } from "../doc/types";

/**
 * A pin bookmarks a place on the board: number keys jump the camera to it, centered on the pin at
 * the zoom saved with it. A pin is a point (`x/y`, with `w/h` 0) drawn as a marker of constant
 * screen size, its tip on the point. At most nine pins, one per number key.
 */

// A type alias, not an interface: node data is typed Record<string, unknown>.
export type PinData = {
  /** 1–9: the number key that jumps to it. */
  slot: number;
  title: string;
  /** The zoom a jump arrives at. */
  zoom: number;
  color: PinColor;
};

export type PinColor = "default" | "red" | "orange" | "yellow" | "green" | "blue" | "purple";

/** "default" is the accent; the rest are the theme's named colors (app.css), like frames and links. */
export const PIN_COLORS: Record<PinColor, { color: string; label: string }> = {
  default: { color: "var(--accent)", label: "Accent" },
  red: { color: "var(--c-red)", label: "Red" },
  orange: { color: "var(--c-orange)", label: "Orange" },
  yellow: { color: "var(--c-yellow)", label: "Yellow" },
  green: { color: "var(--c-green)", label: "Green" },
  blue: { color: "var(--c-blue)", label: "Blue" },
  purple: { color: "var(--c-purple)", label: "Purple" },
};

/** A pin's color as CSS. */
export const pinColor = (d: PinData) => PIN_COLORS[d.color].color;

export const MAX_PINS = 9;

export const DEFAULT_PIN: PinData = { slot: 1, title: "", zoom: 1, color: "default" };

export function pinData(data: unknown): PinData {
  const d = { ...DEFAULT_PIN, ...(data as Partial<PinData> | null) };
  const slot = Math.min(MAX_PINS, Math.max(1, Math.round(d.slot) || 1));
  const zoom = Number.isFinite(d.zoom) && d.zoom > 0 ? d.zoom : 1;
  const color = d.color in PIN_COLORS ? d.color : "default";
  return { ...d, slot, zoom, color, title: typeof d.title === "string" ? d.title : "" };
}

// A plain boolean, not a type guard: as a guard, "not a pin" would narrow nodes to never.
export const isPin = (n: CanvasNode | undefined): boolean => n?.kind === "pin";

/** The marker's size on screen (px): a round head above a tip on the pin's point. */
export const PIN_W = 30;
export const PIN_H = 40;

/**
 * The marker as a node-shaped box in world units at this zoom (tip at the bottom middle): what
 * links attach to, link handles sit around, and hovering and link drops hit. The pin itself stays
 * a point.
 */
export function pinBox(n: CanvasNode, zoom: number): CanvasNode {
  const w = PIN_W / zoom, h = PIN_H / zoom;
  return { ...n, x: n.x - w / 2, y: n.y - h, w, h, rotation: 0 };
}

/**
 * The title flag, as PinContent draws it (screen px from the pin's point): it starts 17 px right of
 * the point, its text is at most 220 px wide plus 18 px of padding, and its middle is 25 px up.
 */
const FLAG_LEFT = 17;
const FLAG_TEXT_MAX = 220;
const FLAG_PADDING = 18;
const FLAG_MIDDLE = 25;

let measurer: CanvasRenderingContext2D | null = null;
const flagWidths = new Map<string, number>();

/** The flag's width for a title (measured once per title, in the app's own font). */
function flagWidth(title: string): number {
  let w = flagWidths.get(title);
  if (w === undefined) {
    if (!measurer && typeof document !== "undefined") {
      measurer = document.createElement("canvas").getContext("2d");
      if (measurer) measurer.font = `550 13px ${getComputedStyle(document.documentElement).fontFamily}`;
    }
    const text = measurer ? measurer.measureText(title).width : title.length * 7;
    w = Math.min(FLAG_TEXT_MAX, text) + FLAG_PADDING;
    flagWidths.set(title, w);
  }
  return w;
}

/**
 * Where a titled pin's right side is for links: the end of its title flag, level with it (so the
 * right link dot sits after the title, not on it). `box` is the marker's box (`pinBox`); null
 * for a pin without a title (the marker's own side).
 */
export function pinRightAnchor(box: CanvasNode): { x: number; y: number } | null {
  const title = pinData(box.data).title.trim();
  if (!title || box.w <= 0) return null;
  const zoom = PIN_W / box.w;
  return { x: box.x + box.w / 2 + (FLAG_LEFT + flagWidth(title)) / zoom, y: box.y + box.h - FLAG_MIDDLE / zoom };
}

/**
 * What hovering a pin covers: its marker, stretched right to the end of its title flag, so the
 * pointer can travel from the marker to the right link dot (after the title) without losing it.
 */
export function pinHoverBox(box: CanvasNode): CanvasNode {
  const right = pinRightAnchor(box);
  return right ? { ...box, w: Math.max(box.w, right.x - box.x) } : box;
}

/** "Pin 3" or "3 · Title" (for menus and other apps). */
export function pinLabel(d: PinData): string {
  return d.title.trim() ? `${d.slot} · ${d.title.trim()}` : `Pin ${d.slot}`;
}
