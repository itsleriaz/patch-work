import { checklistData } from "../checklist/model";
import { counterData } from "../counter/model";
import { paletteData } from "../palette/model";
import { rotate } from "../doc/geometry";
import type { CanvasNode } from "../doc/types";
import { tableData } from "../table/model";
import { timerData } from "../timer/model";
import { textData } from "../text/palette";

/**
 * "Flowing" cards: text, checklists, counters, timers, tables and palettes. Their height follows their content
 * (measured, not stored by the user), their size comes from a font size in `data`, corner handles
 * scale that font, and side handles change their width (not tables: theirs is their columns').
 */
export const isFlow = (n: CanvasNode) => n.kind === "text" || n.kind === "checklist" || n.kind === "counter" || n.kind === "table" || n.kind === "palette" || n.kind === "timer";

function dataOf(n: CanvasNode): { fontSize: number } {
  if (n.kind === "checklist") return checklistData(n.data);
  if (n.kind === "counter") return counterData(n.data);
  if (n.kind === "table") return tableData(n.data);
  if (n.kind === "palette") return paletteData(n.data);
  if (n.kind === "timer") return timerData(n.data);
  return textData(n.data);
}

export function fontSizeOf(n: CanvasNode): number {
  return dataOf(n).fontSize;
}

/**
 * How far a rotated card must move so its top-left corner (in its own frame) stays put when its
 * size changes by `dw` × `dh`: rotation is about the center, which moves along the card's own axes.
 * Zero for an unrotated card.
 */
export function growShift(dw: number, dh: number, rotation: number): { x: number; y: number } {
  const v = { x: dw / 2, y: dh / 2 };
  const r = rotate(v, rotation);
  return { x: r.x - v.x, y: r.y - v.y };
}

/** Sets a flowing card's measured size, its top-left corner staying where it is (rotated too). */
export function fitSize(n: CanvasNode, w: number, h: number) {
  const d = growShift(w - n.w, h - n.h, n.rotation);
  if (d.x || d.y) {
    n.x += d.x;
    n.y += d.y;
  }
  if (w !== n.w) n.w = w;
  if (h !== n.h) n.h = h;
}

/** `data` with a new font size, keeping everything else (defaults filled in). */
export function withFontSize(n: CanvasNode, fontSize: number): Record<string, unknown> {
  return { ...dataOf(n), fontSize } as Record<string, unknown>;
}
