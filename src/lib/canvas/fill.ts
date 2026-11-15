import type { CanvasNode } from "../doc/types";
import { TEXT_COLORS, textData } from "../text/palette";

/**
 * A node drawn as a plain shape (the minimap, collapsed frames' previews): text cards in their
 * card color, files in `--mm-media`, other cards in `--mm-card` (both defined where it's used),
 * drawings with no fill.
 */
export function nodeFill(n: CanvasNode): string {
  if (n.kind === "text") {
    const c = TEXT_COLORS[textData(n.data).color];
    return c && c.bg !== "transparent" ? c.bg : "var(--mm-card)";
  }
  if (n.kind === "drawing") return "transparent";
  if (n.kind === "image" || n.kind === "gif" || n.kind === "video" || n.kind === "audio" || n.kind === "pdf" || n.kind === "sprite") return "var(--mm-media)";
  return "var(--mm-card)";
}
