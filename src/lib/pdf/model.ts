/**
 * A PDF node shows one page of its document at a time. Pages are pictures rendered by pdf.js
 * (`pdf.svelte.ts`); there's no text layer.
 */

// A type alias, not an interface: node data is typed Record<string, unknown>.
export type PdfData = {
  /** The page shown, from 0. Clamped to the document's pages when shown. */
  page: number;
};

export const DEFAULT_PDF: PdfData = { page: 0 };

export function pdfData(data: unknown): PdfData {
  const d = { ...DEFAULT_PDF, ...(data as Partial<PdfData> | null) };
  return { page: Number.isInteger(d.page) && d.page >= 0 ? d.page : 0 };
}

/** PDF sizes are in points (1/72 in); the board's "native size" is CSS pixels (1/96 in), as in a browser's PDF viewer. */
export const PX_PER_PT = 96 / 72;

/** Rendered resolutions: the longest side in device pixels. Like image levels, but rendered by the webview. */
export const PDF_LEVELS = [256, 1024, 2048, 4096];

/** The smallest level covering `displayPx` (the node's longest side on screen, in device px). */
export const pdfLevel = (displayPx: number) => PDF_LEVELS.find((l) => l >= displayPx) ?? PDF_LEVELS[PDF_LEVELS.length - 1];

/** "Report" from "Report.pdf". */
export const docTitle = (name: string) => name.replace(/\.pdf$/i, "");
