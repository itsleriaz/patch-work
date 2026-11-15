import type { TextColor, TextData } from "../doc/types";

export const TEXT_COLORS: Record<TextColor, { bg: string; fg: string; label: string }> = {
  none: { bg: "transparent", fg: "var(--text)", label: "No card" },
  ink: { bg: "#363c40", fg: "#e2ddd1", label: "Ink" },
  paper: { bg: "#f6f1e3", fg: "#3a382f", label: "Paper" },
  yellow: { bg: "#f1dd9e", fg: "#46380f", label: "Yellow" },
  green: { bg: "#c5e3c6", fg: "#1d3d26", label: "Green" },
  blue: { bg: "#c4d8e8", fg: "#1c344e", label: "Blue" },
  pink: { bg: "#efc9d6", fg: "#4b2133", label: "Pink" },
};

export const DEFAULT_TEXT: TextData = { md: "", fontSize: 20, align: "left", color: "none" };

export const MIN_FONT = 4;
export const MAX_FONT = 400;

/** Text node data with defaults filled in. */
export function textData(data: unknown): TextData {
  return { ...DEFAULT_TEXT, ...(data as Partial<TextData> | null) };
}
