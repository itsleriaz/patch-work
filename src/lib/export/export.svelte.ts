import { flushSync, mount, unmount } from "svelte";
import { doc, ui } from "../app.svelte";
import { backend } from "../backend";
import DrawingContent from "../canvas/DrawingContent.svelte";
import MapContent from "../canvas/MapContent.svelte";
import type { Asset, CanvasNode } from "../doc/types";
import { checklistData, toMarkdown as checklistMarkdown } from "../checklist/model";
import { describe } from "../outline/outline.svelte";
import { paletteData, toAse, toGpl, toHexList } from "../palette/model";
import { tableData, toCsv, toMarkdown as tableMarkdown } from "../table/model";
import { textData } from "../text/palette";
import { play } from "../juice/sound";
import { exitMap, mapUi } from "../map/map.svelte";
import { mapData } from "../map/model";
import { frames } from "../frame/frames.svelte";
import { frameData } from "../frame/model";
import { settings } from "../settings.svelte";
import { maskOf, sequence, spriteData, tagOf } from "../sprite/model";
import { currentFrame, spriteMeta } from "../sprite/sprites.svelte";

/**
 * Exporting nodes as files. Maps and drawings become SVG or PNG: both are SVG on the board
 * already, so an export renders the node's content offscreen (in the theme picked for it, through
 * `data-theme-scope`), copies the SVG, and writes every computed style into it, so the file stands
 * alone: no classes, no CSS variables. A PNG draws that SVG onto a canvas at the chosen scale.
 * Sprites are rendered by Rust; text cards and checklists become Markdown, tables CSV or Markdown,
 * palettes a swatch file or a PNG; pictures, videos, audio and PDFs are their own files, copied.
 */

export type ExportFormat = "svg" | "png";
export type ExportTheme = "light" | "dark";
export type ExportBackground = "none" | "card" | "white";

/** How a node exports: a rendered picture, a sprite, text, a table, a palette, or its own file. */
export type ExportKind = "vector" | "sprite" | "text" | "table" | "palette" | "file";

export function exportKind(n: CanvasNode | undefined): ExportKind | null {
  switch (n?.kind) {
    case "map":
    case "drawing":
      return "vector";
    case "sprite":
      return "sprite";
    case "text":
    case "checklist":
      return "text";
    case "table":
      return "table";
    case "palette":
      return "palette";
    case "image":
    case "gif":
    case "video":
    case "audio":
    case "pdf":
      return "file";
  }
  return null;
}

export const isExportable = (n: CanvasNode | undefined) => exportKind(n) !== null;

class ExportUi {
  /** The nodes the export dialog is open for: one, or several (a batch into a folder). */
  ids = $state<string[]>([]);
  busy = $state(false);
  /** The one node, when it isn't a batch. */
  get nodeId() {
    return this.ids.length === 1 ? this.ids[0] : null;
  }
}
export const exportUi = new ExportUi();

export function openExport(ids: string[]) {
  // The edit overlays would come along otherwise.
  if (mapUi.editing && ids.includes(mapUi.editing)) exitMap();
  exportUi.ids = ids;
}

export const closeExport = () => (exportUi.ids = []);

/**
 * A file name for a node's export: \`base\` after the title of the frame it's in, if that has one
 * ("Crypt – Map"), so a batch doesn't come out as Map, Map (2), Map (3).
 */
function exportName(node: CanvasNode, base: string) {
  const frame = frames.owner.get(node.id);
  const title = frame ? frameData(doc.nodes[frame]?.data).title.trim() : "";
  return title ? `${title} – ${base}` : base;
}

export interface ExportOptions {
  theme: ExportTheme;
  background: ExportBackground;
  /** Maps: the faint grid on the floor. */
  grid: boolean;
}

/** Presentation properties copied from the computed style of every element. */
const PROPS = [
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "opacity", "paint-order", "font-family", "font-size", "font-weight",
  "font-style", "letter-spacing", "text-anchor", "dominant-baseline",
] as const;
/**
 * What an SVG element has without any styles (as engines compute them): a root element's values
 * matching these, and anything a child would inherit from its parent anyway, aren't written.
 */
const INITIAL: Record<string, string> = {
  fill: "#000000", "fill-opacity": "1", "fill-rule": "nonzero", stroke: "none", "stroke-width": "1px", "stroke-opacity": "1",
  "stroke-dasharray": "none", "stroke-dashoffset": "0px", "stroke-linecap": "butt", "stroke-linejoin": "miter", "stroke-miterlimit": "4",
  opacity: "1", "paint-order": "normal", "font-style": "normal", "font-weight": "400", "letter-spacing": "normal", "text-anchor": "start",
  "dominant-baseline": "auto",
};
/** Not inherited: written whenever it isn't the initial value. */
const OWN = new Set(["opacity", "dominant-baseline"]);
const TEXT_ONLY = new Set(["font-family", "font-size", "font-weight", "font-style", "letter-spacing", "text-anchor", "dominant-baseline"]);

/**
 * A color as `#rrggbb` or `rgba(…)`, whatever form the engine computed it in (`color(srgb …)`,
 * from `color-mix`, isn't understood by every SVG reader). Read back from a 1×1 canvas.
 */
const colors = new Map<string, string>();
let probe: CanvasRenderingContext2D | null = null;
function plainColor(value: string): string {
  if (value === "none" || value.startsWith("url(") || value.startsWith("#")) return value;
  let out = colors.get(value);
  if (out) return out;
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return value;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  const hex = (v: number) => v.toString(16).padStart(2, "0");
  out = a === 0 ? "none" : a === 255 ? `#${hex(r)}${hex(g)}${hex(b)}` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  colors.set(value, out);
  return out;
}

/** `url("http://…/#hatch-1")` (how engines compute it) → `url(#hatch-1)`. */
const localUrl = (value: string) => value.replace(/url\(\s*["']?[^#"')]*(#[^"')]+)["']?\s*\)/g, "url($1)");

/**
 * Copies each source element's computed presentation into its copy, as a `style` attribute:
 * only what differs from what it would get anyway (inherited from `parent`, or initial).
 */
function inlineStyles(src: Element, out: Element, parent: Record<string, string> = INITIAL) {
  const cs = getComputedStyle(src);
  if (cs.display === "none") return void out.remove();
  const text = src.tagName === "text" || src.tagName === "tspan";
  const values: Record<string, string> = {};
  const decls: string[] = [];
  for (const p of PROPS) {
    // Font properties are only written on text, so text inherits nothing else's.
    if (TEXT_ONLY.has(p) && !text) {
      values[p] = parent[p];
      continue;
    }
    let v = cs.getPropertyValue(p).trim();
    if (p === "fill" || p === "stroke") v = plainColor(localUrl(v));
    values[p] = v;
    if (!v) continue;
    if (v === (OWN.has(p) ? INITIAL[p] : parent[p])) continue;
    decls.push(`${p}: ${v}`);
  }
  out.removeAttribute("class");
  out.removeAttribute("aria-hidden");
  if (decls.length) out.setAttribute("style", decls.join("; "));
  else out.removeAttribute("style");
  // Svelte's markers.
  for (const c of [...out.childNodes]) if (c.nodeType === Node.COMMENT_NODE) c.remove();
  const kids = [...src.children], copies = [...out.children];
  kids.forEach((k, i) => copies[i] && inlineStyles(k, copies[i], values));
}

/** The node's content as a standalone SVG document, sized like the node (world units as px). */
export function exportSvg(node: CanvasNode, opts: ExportOptions): string {
  const host = document.createElement("div");
  host.dataset.themeScope = opts.theme;
  Object.assign(host.style, { position: "fixed", left: "-100000px", top: "0", width: `${node.w}px`, height: `${node.h}px`, pointerEvents: "none" });
  document.body.appendChild(host);
  const component = mount(node.kind === "map" ? MapContent : DrawingContent, { target: host, props: { node: $state.snapshot(node) as CanvasNode } });
  flushSync();
  try {
    const src = host.querySelector("svg");
    if (!src) throw new Error("nothing to export");
    const svg = src.cloneNode(true) as SVGSVGElement;
    inlineStyles(src, svg);
    svg.removeAttribute("style");
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", String(Math.round(node.w)));
    svg.setAttribute("height", String(Math.round(node.h)));

    if (!opts.grid) {
      for (const el of svg.querySelectorAll('[fill^="url(#grid-"]')) el.remove();
      for (const el of svg.querySelectorAll('pattern[id^="grid-"]')) el.remove();
    }
    if (opts.background !== "none") {
      const [x, y, w, h] = (svg.getAttribute("viewBox") ?? `0 0 ${node.w} ${node.h}`).split(/[\s,]+/);
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      Object.entries({ x, y, width: w, height: h }).forEach(([k, v]) => rect.setAttribute(k, v));
      rect.setAttribute("fill", opts.background === "white" ? "#ffffff" : plainColor(getComputedStyle(host).getPropertyValue("--panel-solid").trim()));
      svg.insertBefore(rect, svg.querySelector("defs")?.nextSibling ?? svg.firstChild);
    }
    // game-icons.net's symbols are CC BY 3.0: credit them in the file.
    const stamped = node.kind === "map" && (mapData(node.data).stamps?.length ?? 0) > 0;
    const desc = document.createElementNS("http://www.w3.org/2000/svg", "desc");
    desc.textContent = stamped ? "Made with Patchwork. Map symbols by game-icons.net contributors, CC BY 3.0." : "Made with Patchwork.";
    svg.insertBefore(desc, svg.firstChild);

    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}\n`;
  } finally {
    unmount(component);
    host.remove();
  }
}

/** Canvas limits differ by engine; staying under these is safe everywhere. */
const MAX_SIDE = 16384;
const MAX_AREA = 120_000_000;

/** The PNG's size at this scale, kept under the canvas limits. */
export function pngSize(node: CanvasNode, scale: number) {
  const k = Math.min(scale, MAX_SIDE / node.w, MAX_SIDE / node.h, Math.sqrt(MAX_AREA / (node.w * node.h)));
  return { w: Math.max(1, Math.round(node.w * k)), h: Math.max(1, Math.round(node.h * k)), clamped: k < scale };
}

async function toPng(svg: string, w: number, h: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A sprite as the dialog's options make it (Rust renders it): the current frame as PNG, or the
 * playing tag's frames (every frame without one), in playing order, as a sheet or a GIF.
 */
export async function spriteExport(node: CanvasNode) {
  const asset = doc.assetOf(node);
  const meta = asset && spriteMeta(asset);
  if (!asset || !meta || meta === "failed") throw new Error("the sprite isn't loaded");
  const d = spriteData(node.data);
  const tag = tagOf(meta, d);
  const kind = settings.spriteExport;
  const frames = kind === "png" ? [currentFrame(node, meta)] : sequence(meta, tag);
  const background = settings.spriteBackground === "white" ? "#ffffff" : null;
  const bytes = await backend.exportSprite(asset, { kind, mask: maskOf(meta, d), frames, scale: settings.spriteScale, background });
  const base = asset.name.replace(/\.(aseprite|ase)$/i, "");
  const name = kind === "png" ? `${base} frame ${frames[0] + 1}` : tag ? `${base} ${tag.name}` : base;
  return { bytes, name: exportName(node, name), ext: kind === "gif" ? "gif" : "png" };
}

/** A name from a node's content ("Shopping list", a table's first heading), cut to a sensible length. */
function contentName(node: CanvasNode, fallback: string) {
  const name = describe(node).name.replace(/\s+/g, " ").trim();
  return name ? (name.length > 60 ? name.slice(0, 60).trimEnd() + "…" : name) : fallback;
}

/**
 * The text a text-like export writes (a card's or checklist's Markdown, a table as CSV or
 * Markdown, a palette's GPL or hex list), or null for kinds that aren't text. The dialog previews it.
 */
export function exportText(node: CanvasNode): { text: string; ext: string } | null {
  switch (node.kind) {
    case "text":
      return { text: textData(node.data).md.trimEnd() + "\n", ext: "md" };
    case "checklist":
      return { text: checklistMarkdown(checklistData(node.data)) + "\n", ext: "md" };
    case "table": {
      const d = tableData(node.data);
      return settings.tableExport === "csv" ? { text: toCsv(d), ext: "csv" } : { text: tableMarkdown(d) + "\n", ext: "md" };
    }
    case "palette": {
      const d = paletteData(node.data);
      if (settings.paletteExport === "gpl") return { text: toGpl(d.title, d.colors), ext: "gpl" };
      if (settings.paletteExport === "hex") return { text: toHexList(d.colors), ext: "txt" };
      return null;
    }
  }
  return null;
}

/** A palette's swatches as a picture: 64 px squares, eight to a row. */
export async function paletteImage(node: CanvasNode): Promise<Blob> {
  const colors = paletteData(node.data).colors;
  const CELL = 64, PER_ROW = 8;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.min(colors.length, PER_ROW)) * CELL;
  canvas.height = Math.max(1, Math.ceil(colors.length / PER_ROW)) * CELL;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  colors.forEach((c, i) => {
    ctx.fillStyle = c.hex;
    ctx.fillRect((i % PER_ROW) * CELL, Math.floor(i / PER_ROW) * CELL, CELL, CELL);
  });
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));
}

/** What exporting a node writes: bytes, or the node's own file (`asset`) copied as it is. */
type Output = { bytes?: Blob; asset?: Asset; name: string; ext: string; clamped?: string };

/** A node's file with the remembered options: what to write, its name (no extension), extension. */
async function render(node: CanvasNode): Promise<Output> {
  if (node.kind === "sprite") return spriteExport(node);
  const kind = exportKind(node);
  if (kind === "file") {
    const asset = doc.assetOf(node);
    if (!asset) throw new Error("no file");
    const dot = asset.name.lastIndexOf(".");
    return { asset, name: exportName(node, dot > 0 ? asset.name.slice(0, dot) : asset.name), ext: dot > 0 ? asset.name.slice(dot + 1) : "" };
  }
  if (kind === "text" || kind === "table" || kind === "palette") {
    // Tables have no title (their first heading names a column, not the table).
    const base = node.kind === "palette" ? paletteData(node.data).title.trim() || "Palette" : node.kind === "table" ? "Table" : contentName(node, "Text");
    const name = exportName(node, base);
    const text = exportText(node);
    if (text) return { bytes: new Blob([text.text], { type: "text/plain" }), name, ext: text.ext };
    const d = paletteData(node.data);
    if (settings.paletteExport === "ase") return { bytes: new Blob([toAse(d.title, d.colors)], { type: "application/octet-stream" }), name, ext: "ase" };
    return { bytes: await paletteImage(node), name, ext: "png" };
  }
  const opts = { theme: settings.exportTheme, background: settings.exportBackground, grid: settings.exportGrid };
  const svg = exportSvg(node, opts);
  const name = exportName(node, node.kind === "map" ? "Map" : "Drawing");
  if (settings.exportFormat !== "png") return { bytes: new Blob([svg], { type: "image/svg+xml" }), name, ext: "svg" };
  const size = pngSize(node, settings.exportScale);
  return { bytes: await toPng(svg, size.w, size.h), name, ext: "png", clamped: size.clamped ? `${size.w}×${size.h}` : undefined };
}

const fileOf = (path: string) => path.split(/[\\/]/).pop();
const show = (path: string) => (backend.kind === "tauri" ? { label: "Show", run: () => backend.revealFile(path) } : undefined);

/**
 * Exports the dialog's nodes with the remembered options and says so: one asks where to save it;
 * several ask for a folder and go in under their own names (never over an existing file).
 */
export async function runExport() {
  const nodes = exportUi.ids.map((id) => doc.nodes[id]).filter(isExportable) as CanvasNode[];
  if (!nodes.length || exportUi.busy) return;
  exportUi.busy = true;
  try {
    if (nodes.length === 1) {
      const out = await render(nodes[0]);
      const path = out.asset ? await backend.exportAssetFile(out.asset, out.name, out.ext) : await backend.exportFile(out.name, out.ext, out.bytes!);
      if (!path) return;
      closeExport();
      play("done");
      const note = out.clamped ? ` (made smaller: ${out.clamped} is the largest PNG that's safe)` : "";
      return ui.notify(`Exported ${fileOf(path)}${note}`, "info", show(path));
    }
    const dir = await backend.pickFolder(`Export ${nodes.length} files to`);
    if (!dir) return;
    let first: string | null = null, failed = 0;
    for (const node of nodes) {
      try {
        const out = await render(node);
        const file = out.ext ? `${out.name}.${out.ext}` : out.name;
        const path = out.asset ? await backend.exportAssetInto(out.asset, dir, file) : await backend.exportInto(dir, file, out.bytes!);
        first ??= path;
      } catch {
        failed++;
      }
    }
    closeExport();
    const done = nodes.length - failed;
    if (!done) return ui.notify("Couldn't export any of them", "warn");
    play("done");
    const folder = fileOf(dir);
    const msg = `Exported ${done} file${done > 1 ? "s" : ""} to ${folder}` + (failed ? `; ${failed} couldn't be` : "");
    ui.notify(msg, failed ? "warn" : "info", first ? show(first) : undefined);
  } catch (e) {
    ui.notify(`Couldn't export: ${e instanceof Error ? e.message : e}`, "warn");
  } finally {
    exportUi.busy = false;
  }
}
