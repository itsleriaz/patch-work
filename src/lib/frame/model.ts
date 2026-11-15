import { aabb, union } from "../doc/geometry";
import type { CanvasNode, Rect } from "../doc/types";

/**
 * A frame groups nodes so they move together. Membership is stored on the frame (`members`), one
 * level only: a frame is never a member of another frame, and a node belongs to at most one frame.
 * Members that no longer exist are skipped, so deleting a node needs no frame update, and undoing
 * the delete brings it back into its frame.
 *
 * Two sizing modes, by `size`:
 * - Auto-fit (`size` null): the box is the members' bounds plus padding and a title bar, kept up
 *   to date by `syncFrames`. One left with no members is removed.
 * - Manual (`size` set): `x/y` are real state and the box is `size`. Resizing decides membership
 *   (nodes whose center is inside belong to it). It stays when emptied.
 * A collapsed frame is a compact card at its `x/y` instead; its members are hidden (and move with it).
 */

export type FrameColor = "default" | "red" | "orange" | "yellow" | "green" | "blue" | "purple";

// A type alias, not an interface: node data is typed Record<string, unknown>.
export type FrameData = {
  title: string;
  members: string[];
  collapsed: boolean;
  color: FrameColor;
  /** A manual frame's expanded size; null for auto-fit. */
  size: { w: number; h: number } | null;
  /** A template: "New from template" stamps out fresh copies of it (frame/templates.svelte.ts). */
  template?: boolean;
};

export const DEFAULT_FRAME: FrameData = { title: "", members: [], collapsed: false, color: "default", size: null };

export function frameData(data: unknown): FrameData {
  const d = { ...DEFAULT_FRAME, ...(data as Partial<FrameData> | null) };
  const size = d.size && typeof d.size.w === "number" && typeof d.size.h === "number" ? d.size : null;
  return { ...d, members: Array.isArray(d.members) ? d.members : [], size };
}

/** Space around the members, and the title bar's height, in world units. */
export const FRAME_PAD = 24;
export const FRAME_TITLE = 40;
/** A collapsed frame's size. */
export const COLLAPSED_W = 260;
export const COLLAPSED_H = 52;
/** A collapsed frame's preview of its contents: inset by this, between these heights. */
export const PREVIEW_PAD = 10;
const PREVIEW_MIN_H = 60;
const PREVIEW_MAX_H = 200;

/**
 * A collapsed frame's card: the title strip, and with a preview, the contents' shape below it
 * (as tall as the width gives it, within limits).
 */
export function collapsedSize(contents: Rect | null, preview: boolean) {
  if (!preview || !contents || contents.w <= 0 || contents.h <= 0) return { w: COLLAPSED_W, h: COLLAPSED_H };
  const inner = COLLAPSED_W - PREVIEW_PAD * 2;
  const h = Math.min(PREVIEW_MAX_H, Math.max(PREVIEW_MIN_H, (inner * contents.h) / contents.w));
  return { w: COLLAPSED_W, h: COLLAPSED_H + h + PREVIEW_PAD };
}
/** A manual frame's smallest size, and a new empty frame's size. */
export const MIN_FRAME_W = 160;
export const MIN_FRAME_H = FRAME_TITLE + 40;
export const NEW_FRAME_W = 480;
export const NEW_FRAME_H = 320;

/** Tints: a light fill and a stronger edge and title. "default" is the theme's `--frame`; the rest are its named colors (app.css). */
export const FRAME_COLORS: Record<FrameColor, { color: string; label: string }> = {
  default: { color: "var(--frame)", label: "Default" },
  red: { color: "var(--c-red)", label: "Red" },
  orange: { color: "var(--c-orange)", label: "Orange" },
  yellow: { color: "var(--c-yellow)", label: "Yellow" },
  green: { color: "var(--c-green)", label: "Green" },
  blue: { color: "var(--c-blue)", label: "Blue" },
  purple: { color: "var(--c-purple)", label: "Purple" },
};

// A plain boolean, not a type guard: as a guard, "not a frame" would narrow nodes to never.
export const isFrame = (n: CanvasNode | undefined): boolean => n?.kind === "frame";

export const isManual = (n: CanvasNode): boolean => frameData(n.data).size !== null;

/** Whether a point is inside a box (edges included). */
export const contains = (r: Rect, p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** A node's center, the point that decides which frame it belongs to. */
export const centerOf = (n: CanvasNode) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

/** The box an expanded frame should have around these members. */
export function fitRect(members: CanvasNode[]): Rect | null {
  const b = union(members.map(aabb));
  if (!b) return null;
  return {
    x: b.x - FRAME_PAD,
    y: b.y - FRAME_PAD - FRAME_TITLE,
    w: b.w + FRAME_PAD * 2,
    h: b.h + FRAME_PAD * 2 + FRAME_TITLE,
  };
}
