import type { LinkColor, LinkData } from "../doc/types";
import { settings } from "../settings.svelte";

/** Line colors. "default" is the theme's `--link`; the rest are the theme's named colors (app.css). */
export const LINK_COLORS: Record<LinkColor, { stroke: string; label: string }> = {
  default: { stroke: "var(--link)", label: "Default" },
  red: { stroke: "var(--c-red)", label: "Red" },
  orange: { stroke: "var(--c-orange)", label: "Orange" },
  yellow: { stroke: "var(--c-yellow)", label: "Yellow" },
  green: { stroke: "var(--c-green)", label: "Green" },
  blue: { stroke: "var(--c-blue)", label: "Blue" },
  purple: { stroke: "var(--c-purple)", label: "Purple" },
};

export const DEFAULT_LINK: LinkData = { shape: "curve", arrow: "end", color: "default", dashed: false, label: "" };

/** Link data with defaults filled in. */
export function linkData(data: unknown): LinkData {
  return { ...DEFAULT_LINK, ...(data as Partial<LinkData> | null) };
}

/**
 * Data for a link being created: the "New links" preferences are written into it, so changing
 * them later never restyles existing links.
 */
export function newLinkData(): Partial<LinkData> {
  return { shape: settings.linkShape, arrow: settings.linkArrow };
}

/** The ends' pinned sides, for `linkPath`. */
export function linkSides(data: unknown): { from: LinkData["fromSide"]; to: LinkData["toSide"] } {
  const d = linkData(data);
  return { from: d.fromSide ?? null, to: d.toSide ?? null };
}
