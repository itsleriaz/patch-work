import type { CanvasNode } from "../doc/types";

/**
 * A sprite: an Aseprite file on the board (`sprite.rs` reads it). Its node keeps which tag plays
 * and which layers show, as overrides of the file's own visibility by layer name (names survive
 * layers being added or reordered in Aseprite). Playing and the current frame are session state.
 */
export type SpriteData = {
  /** The tag that plays (by name); null or a tag that's gone: every frame. */
  tag: string | null;
  /** Layer name → shown, where it differs from the file. */
  layers: Record<string, boolean>;
  flipX?: boolean;
  flipY?: boolean;
};

export const DEFAULT_SPRITE: SpriteData = { tag: null, layers: {} };

export function spriteData(data: unknown): SpriteData {
  const d = (data ?? {}) as Partial<SpriteData>;
  return { ...DEFAULT_SPRITE, ...d, layers: { ...(d.layers ?? {}) } };
}

export const isSprite = (n: CanvasNode | undefined) => n?.kind === "sprite";

export type TagDirection = "forward" | "reverse" | "pingpong";

/** What `pw://…/sprite/<id>/meta` describes. */
export interface SpriteMeta {
  width: number;
  height: number;
  /** Frames per row in a sheet. */
  columns: number;
  /** Each frame's duration in ms. */
  frames: number[];
  /** Image layers, bottom to top; `index` is the layer's place in the file. */
  layers: { index: number; name: string; visible: boolean; blend: string; opacity: number }[];
  tags: { name: string; from: number; to: number; direction: TagDirection; repeat: number | null; color: string | null }[];
}

export type SpriteLayer = SpriteMeta["layers"][number];
export type SpriteTag = SpriteMeta["tags"][number];

export const layerShown = (data: SpriteData, layer: SpriteLayer) => data.layers[layer.name] ?? layer.visible;

/** The sheet to show: "file" for the file's own visibility, else one 0/1 per layer index. */
export function maskOf(meta: SpriteMeta, data: SpriteData): string {
  if (meta.layers.every((l) => layerShown(data, l) === l.visible)) return "file";
  const mask = Array.from({ length: Math.max(0, ...meta.layers.map((l) => l.index + 1)) }, () => "0");
  for (const l of meta.layers) if (layerShown(data, l)) mask[l.index] = "1";
  return mask.join("");
}

/** The tag that plays, if it's still in the file. */
export const tagOf = (meta: SpriteMeta, data: SpriteData) => (data.tag ? meta.tags.find((t) => t.name === data.tag) : undefined);

/** Frame indices in playing order, one loop: the tag's range in its direction, or every frame. */
export function sequence(meta: SpriteMeta, tag: SpriteTag | undefined): number[] {
  const n = meta.frames.length;
  if (!n) return [];
  const from = Math.min(tag?.from ?? 0, n - 1), to = Math.min(tag?.to ?? n - 1, n - 1);
  const up = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  switch (tag?.direction) {
    case "reverse":
      return up.reverse();
    case "pingpong":
      // There and back, without repeating the ends.
      return [...up, ...up.slice(1, -1).reverse()];
    default:
      return up;
  }
}

/** Where frame `index` sits in a sheet, as background-position percentages. */
export function sheetPosition(meta: SpriteMeta, index: number) {
  const cols = meta.columns, rows = Math.ceil(meta.frames.length / cols);
  const col = index % cols, row = Math.floor(index / cols);
  return { x: cols > 1 ? (col / (cols - 1)) * 100 : 0, y: rows > 1 ? (row / (rows - 1)) * 100 : 0, cols, rows };
}
