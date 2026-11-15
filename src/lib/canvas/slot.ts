import type { CanvasNode, MediaData } from "../doc/types";

/**
 * Picture slots: an image or GIF whose box keeps its shape. The picture inside is scaled to fit
 * (letterboxed) or fill (cropped) the box, so replacing the file never changes the box.
 */
export type SlotMode = "fit" | "fill";

export const canSlot = (n: CanvasNode) => n.kind === "image" || n.kind === "gif";

/** The slot mode of a node, or null for a picture that follows its own shape (and everything else). */
export function slotOf(n: CanvasNode): SlotMode | null {
  if (!canSlot(n)) return null;
  const m = (n.data ?? {}) as MediaData;
  return m.slot === "fit" || m.slot === "fill" ? m.slot : null;
}

/** Where a filled picture sits in its box, 0..1 on each axis (0.5 = centered). */
export function focusOf(n: CanvasNode): { x: number; y: number } {
  const f = ((n.data ?? {}) as MediaData).focus;
  const c = (v: number | undefined) => (typeof v === "number" ? Math.min(1, Math.max(0, v)) : 0.5);
  return { x: c(f?.x), y: c(f?.y) };
}
