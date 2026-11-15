import { settings } from "../settings.svelte";
import type { Asset, Rect } from "../doc/types";

/** Spacing between packed nodes, and the duplicate offset unit. Snapping uses `settings.gridSize`. */
export const GRID = 20;

/**
 * The longest side of a newly imported picture, video or PDF, in world units: a multiple of the
 * "New text" size (`settings.importSize`), so imports and new cards look right together whatever
 * that size is (Medium: 600 at size 20, about two cards wide). Native size has no cap.
 */
export const IMPORT_SCALE = { small: 20, medium: 30, large: 50, native: Infinity } as const;
export const importMaxSide = () => IMPORT_SCALE[settings.importSize] * settings.textSize;

export const snap = (v: number, step = settings.gridSize) => Math.round(v / step) * step;

export function importSize(width: number, height: number) {
  const k = Math.min(1, importMaxSide() / Math.max(width, height));
  return { w: Math.max(1, Math.round(width * k)), h: Math.max(1, Math.round(height * k)) };
}

/** Audio has no picture: its card has a fixed starting size. */
export const AUDIO_SIZE = { w: 360, h: 96 };

/** The size a node for this asset starts at (and returns to with "Reset transform"). */
export function assetSize(asset: Asset) {
  if (asset.kind === "audio") return { ...AUDIO_SIZE };
  if (asset.kind === "sprite") return spriteSize(asset.width, asset.height);
  return importSize(asset.width, asset.height);
}

/**
 * Pixel art comes in scaled by a whole number, so every pixel stays square and sharp: up to about
 * half the import size, never below its own size (or capped like any picture when it's huge).
 */
export function spriteSize(width: number, height: number) {
  const side = Math.max(width, height, 1), cap = importMaxSide();
  if (side > cap) return importSize(width, height);
  const k = Number.isFinite(cap) ? Math.max(1, Math.floor(cap / 2 / side)) : 1;
  return { w: width * k, h: height * k };
}

/**
 * Shelf-packs items into rows centered on (cx, cy), snapped to the grid.
 * Returns top-left positions in input order.
 */
export function packAround(cx: number, cy: number, sizes: { w: number; h: number }[], gap = GRID) {
  if (sizes.length === 1) {
    const { w, h } = sizes[0];
    return [{ x: snap(cx - w / 2), y: snap(cy - h / 2) }];
  }
  const area = sizes.reduce((sum, s) => sum + (s.w + gap) * (s.h + gap), 0);
  const rowWidth = Math.max(Math.sqrt(area) * 1.4, ...sizes.map((s) => s.w));

  const placed: { x: number; y: number }[] = [];
  let x = 0, y = 0, rowH = 0, totalW = 0;
  for (const s of sizes) {
    if (x > 0 && x + s.w > rowWidth) {
      y += rowH + gap;
      x = 0;
      rowH = 0;
    }
    placed.push({ x, y });
    x += s.w + gap;
    rowH = Math.max(rowH, s.h);
    totalW = Math.max(totalW, x - gap);
  }
  const totalH = y + rowH;
  const ox = cx - totalW / 2, oy = cy - totalH / 2;
  return placed.map((p) => ({ x: snap(ox + p.x), y: snap(oy + p.y) }));
}

/**
 * Where to put `rect` so it overlaps none of `obstacles` (keeping `gap` from them): its own spot
 * if that's free, else the nearest free one, searching outward in rings.
 */
export function nearestFree(rect: Rect, obstacles: Rect[], gap = GRID): { x: number; y: number } {
  const hit = (x: number, y: number) =>
    obstacles.some((o) => x < o.x + o.w + gap && x + rect.w + gap > o.x && y < o.y + o.h + gap && y + rect.h + gap > o.y);
  if (!hit(rect.x, rect.y)) return { x: rect.x, y: rect.y };
  const step = Math.max(GRID, Math.min(rect.w, rect.h) / 4);
  for (let ring = 1; ring <= 80; ring++) {
    const spots: [number, number][] = [];
    for (let i = -ring; i <= ring; i++) {
      spots.push([i, -ring], [i, ring]);
      if (Math.abs(i) < ring) spots.push([-ring, i], [ring, i]);
    }
    spots.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    for (const [i, j] of spots) {
      const x = rect.x + i * step, y = rect.y + j * step;
      if (!hit(x, y)) return { x, y };
    }
  }
  return { x: rect.x, y: rect.y };
}
