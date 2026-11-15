import type { Level } from "../backend";
import type { Asset } from "../doc/types";

/** Longest-side sizes the backend generates. Mirrored in `src-tauri/src/lod.rs`. */
export const LOD_SIZES = [256, 1024, 2048];

/** Smallest level whose resolution covers `displayPx` (the node's longest side on screen, in device px). */
export function pickLevel(asset: Asset, displayPx: number): Level {
  if (asset.kind === "gif") return "full"; // levels are still frames
  const maxDim = Math.max(asset.width, asset.height);
  for (const size of LOD_SIZES) {
    if (size >= maxDim) break;
    if (size >= displayPx) return size;
  }
  return "full";
}

export function levelRank(level: Level | null): number {
  if (level === null) return -1;
  return level === "full" ? Infinity : level;
}
