import { doc, history, markFresh, selectOnly, ui } from "../app.svelte";
import { backend } from "../backend";
import { aabb, frameOf, rotate, type Point } from "../doc/geometry";
import type { CanvasNode, MediaData } from "../doc/types";
import { joinOps } from "../frame/frames.svelte";
import { play } from "../juice/sound";
import { hitsNode } from "../links/geometry";
import { pageOf } from "../pdf/pages.svelte";
import { acquirePage } from "../pdf/pdf.svelte";
import type { MenuEntry } from "../ui/Menu.svelte";
import { DEFAULT_PALETTE, extractColors, hslText, newSwatch, paletteData, rgbText, sortSwatches, toHex, type PaletteData } from "./model";

/**
 * Palettes: adding colors with the eyedropper (from any picture on the board), extracting a
 * palette from a picture, and the swatch commands.
 */

class PaletteUi {
  /** The eyedropper is on, adding to this palette. */
  picking = $state<string | null>(null);
  /** The magnifier under the pointer while picking: where (viewport px), the picture and the pixel. */
  loupe = $state<{ x: number; y: number; url: string; w: number; h: number; px: number; py: number; hex: string } | null>(null);
  /** The palette whose title is being edited. */
  renaming = $state<string | null>(null);
  /** The swatch a right-click menu is for. */
  swatch = $state<{ nodeId: string; colorId: string } | null>(null);
  /** The color picker: for a swatch, or a new color (`colorId` null), placed at x, y (viewport px). */
  picker = $state<{ nodeId: string; colorId: string | null; x: number; y: number } | null>(null);
  /** A swatch just copied or added, by "nodeId:colorId", with a token so it can flash again. */
  flash = $state<{ key: string; n: number } | null>(null);
}
export const paletteUi = new PaletteUi();

export const isPalette = (n: CanvasNode | undefined): boolean => n?.kind === "palette";
/** Nodes showing a picture the eyedropper and extracting can read. */
export const isPicture = (n: CanvasNode | undefined): boolean => n?.kind === "image" || n?.kind === "gif" || n?.kind === "video" || n?.kind === "pdf";

function setPalette(id: string, label: string, change: (d: PaletteData) => PaletteData) {
  const n = doc.nodes[id];
  if (!isPalette(n)) return;
  const d = paletteData($state.snapshot(n.data));
  history.run(label, [{ type: "updateNodes", changes: [{ id, props: { data: change(d) } }] }]);
}

const flashSwatch = (nodeId: string, colorId: string) => (paletteUi.flash = { key: `${nodeId}:${colorId}`, n: (paletteUi.flash?.n ?? 0) + 1 });

// ---------------------------------------------------------------- commands

/** A new, empty palette at `at`, with the eyedropper on, ready to collect colors. */
export function createPalette(at: Point) {
  const node: CanvasNode = {
    id: crypto.randomUUID(),
    kind: "palette",
    assetId: null,
    x: Math.round(at.x - 180),
    y: Math.round(at.y - 60),
    w: 360,
    h: 120,
    rotation: 0,
    z: doc.maxZ() + 1,
    data: { ...DEFAULT_PALETTE },
  };
  history.run("Add palette", [{ type: "addNodes", nodes: [node] }, ...joinOps([node], at)]);
  selectOnly([node.id]);
  markFresh([node.id]);
  startPicking(node.id);
}

export function addColor(id: string, hex: string) {
  const n = doc.nodes[id];
  if (!isPalette(n)) return;
  const d = paletteData(n.data);
  const same = d.colors.find((c) => c.hex === hex.toUpperCase());
  if (same) {
    // Already there: point it out instead of adding it twice.
    flashSwatch(id, same.id);
    return play("denied", { volume: 0.35 });
  }
  const swatch = newSwatch(hex);
  setPalette(id, "Add color", (d) => ({ ...d, colors: [...d.colors, swatch] }));
  flashSwatch(id, swatch.id);
  play("tap", { volume: 0.5, pitch: 1.2 });
}

/** Adds several colors as one step (pasted hex codes), leaving out ones already there. */
export function addColors(id: string, hexes: string[]) {
  const n = doc.nodes[id];
  if (!isPalette(n)) return;
  const have = new Set(paletteData(n.data).colors.map((c) => c.hex));
  const fresh = hexes.map((h) => h.toUpperCase()).filter((h, i, all) => !have.has(h) && all.indexOf(h) === i).map(newSwatch);
  if (!fresh.length) {
    play("denied", { volume: 0.35 });
    return ui.notify(hexes.length === 1 ? "That color is already in the palette" : "Those colors are already in the palette");
  }
  setPalette(id, fresh.length === 1 ? "Add color" : `Add ${fresh.length} colors`, (d) => ({ ...d, colors: [...d.colors, ...fresh] }));
  for (const s of fresh) flashSwatch(id, s.id);
  play("tap", { volume: 0.5, pitch: 1.2 });
}

/** A new palette of pasted hex codes at `at`, in the frame there. */
export function placePalette(hexes: string[], at: Point) {
  const node: CanvasNode = {
    id: crypto.randomUUID(),
    kind: "palette",
    assetId: null,
    x: Math.round(at.x - 180),
    y: Math.round(at.y - 60),
    w: 360,
    h: 120,
    rotation: 0,
    z: doc.maxZ() + 1,
    data: { ...DEFAULT_PALETTE, colors: hexes.map(newSwatch) } satisfies PaletteData,
  };
  history.run("Paste palette", [{ type: "addNodes", nodes: [node] }, ...joinOps([node], at)]);
  selectOnly([node.id]);
  markFresh([node.id]);
  play("appear", { volume: 0.5 });
}

/** Changes one swatch's color (the color picker). */
export function setColor(id: string, colorId: string, hex: string) {
  const n = doc.nodes[id];
  const c = isPalette(n) ? paletteData(n.data).colors.find((c) => c.id === colorId) : undefined;
  if (!c || c.hex === hex.toUpperCase()) return;
  setPalette(id, "Edit color", (d) => ({ ...d, colors: d.colors.map((c) => (c.id === colorId ? { ...c, hex: hex.toUpperCase() } : c)) }));
  flashSwatch(id, colorId);
}

/** Moves a swatch to another place in the strip (dragging it). */
export function moveColor(id: string, colorId: string, to: number) {
  const n = doc.nodes[id];
  if (!isPalette(n)) return;
  const colors = paletteData(n.data).colors;
  const from = colors.findIndex((c) => c.id === colorId);
  if (from < 0 || from === to) return;
  setPalette(id, "Move color", (d) => {
    const next = [...d.colors];
    next.splice(to, 0, ...next.splice(from, 1));
    return { ...d, colors: next };
  });
  play("tap", { volume: 0.45, pitch: 0.9 });
}

export function sortColors(id: string, by: "hue" | "lightness") {
  const n = doc.nodes[id];
  if (!isPalette(n)) return;
  const colors = paletteData(n.data).colors;
  const sorted = sortSwatches(colors, by);
  if (sorted.every((c, i) => c.id === colors[i].id)) return ui.notify("Already in that order");
  setPalette(id, by === "hue" ? "Sort by hue" : "Sort by lightness", (d) => ({ ...d, colors: sortSwatches(d.colors, by) }));
}

/** Opens the color picker for a swatch, or for a new color (`colorId` null), next to `anchor` (screen px). */
export function editColor(nodeId: string, colorId: string | null, anchor?: DOMRect) {
  const n = doc.nodes[nodeId];
  if (!isPalette(n)) return;
  const el = anchor ?? document.querySelector(`[data-node-id="${nodeId}"]`)?.getBoundingClientRect();
  paletteUi.picker = { nodeId, colorId, x: el ? el.left : innerWidth / 2 - 110, y: el ? el.bottom + 8 : innerHeight / 3 };
  stopPicking();
}

export function removeColor(id: string, colorId: string) {
  setPalette(id, "Remove color", (d) => ({ ...d, colors: d.colors.filter((c) => c.id !== colorId) }));
  play("vanish", { volume: 0.4 });
}

export function renamePalette(id: string, title: string) {
  const n = doc.nodes[id];
  if (!isPalette(n) || paletteData(n.data).title === title.trim()) return;
  setPalette(id, "Rename palette", (d) => ({ ...d, title: title.trim() }));
}

export type ColorFormat = "hex" | "rgb" | "hsl";

/** Copies a color as text to the system clipboard. */
export async function copyColor(hex: string, format: ColorFormat = "hex", flash?: { nodeId: string; colorId: string }) {
  const text = format === "rgb" ? rgbText(hex) : format === "hsl" ? hslText(hex) : hex.toUpperCase();
  try {
    await navigator.clipboard.writeText(text);
    if (flash) flashSwatch(flash.nodeId, flash.colorId);
    play("select", { volume: 0.45 });
    ui.notify(`Copied ${text}`);
  } catch (e) {
    ui.notify(`Couldn't copy: ${e}`, "warn");
  }
}

/** A swatch's right-click menu. */
export function swatchMenu(ref: { nodeId: string; colorId: string }): MenuEntry[] {
  const c = paletteData(doc.nodes[ref.nodeId]?.data).colors.find((c) => c.id === ref.colorId);
  if (!c) return [];
  return [
    { label: "Edit color…", run: () => editColor(ref.nodeId, ref.colorId, document.querySelector(`[data-swatch-id="${ref.colorId}"]`)?.getBoundingClientRect()) },
    "-",
    { label: `Copy ${c.hex}`, run: () => void copyColor(c.hex, "hex", ref) },
    { label: `Copy ${rgbText(c.hex)}`, run: () => void copyColor(c.hex, "rgb", ref) },
    { label: `Copy ${hslText(c.hex)}`, run: () => void copyColor(c.hex, "hsl", ref) },
    "-",
    { label: "Remove color", run: () => removeColor(ref.nodeId, ref.colorId) },
  ];
}

// ---------------------------------------------------------------- reading pictures

interface Source {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}
/** Pictures loaded for reading pixels, by URL (a few, most recent last). */
const sources = new Map<string, Promise<Source | null>>();
const SOURCES_KEPT = 6;

/**
 * A picture's pixels, readable. Drawn on a detached canvas (never in the page, so no compositing
 * layer). `pw://` pictures are another origin: loaded with CORS (the protocol allows any origin),
 * else the canvas would refuse to be read.
 */
function readable(url: string): Promise<Source | null> {
  let src = sources.get(url);
  if (src) {
    sources.delete(url);
    sources.set(url, src);
    return src;
  }
  src = new Promise<Source | null>((resolve) => {
    const img = new Image();
    if (!url.startsWith("blob:")) img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0);
      resolve({ canvas, ctx, w: canvas.width, h: canvas.height });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  sources.set(url, src);
  while (sources.size > SOURCES_KEPT) sources.delete(sources.keys().next().value!);
  return src;
}

/** The topmost picture under a world point. */
function pictureAt(p: Point): CanvasNode | undefined {
  let best: CanvasNode | undefined;
  for (const n of doc.nodeList) if (isPicture(n) && (!best || n.z > best.z) && hitsNode(n, p)) best = n;
  return best;
}

/** The picture a node shows right now (the last image in it: a paused video frame sits over its poster). */
function shownImage(n: CanvasNode): HTMLImageElement | null {
  const imgs = document.querySelectorAll<HTMLImageElement>(`[data-node-id="${n.id}"] img`);
  const img = imgs[imgs.length - 1];
  return img?.complete && img.naturalWidth ? img : null;
}

/**
 * Where a world point falls on the picture a node shows, as fractions of the picture (0–1), through
 * the node's rotation, its flips and any letterboxing (PDF pages and videos fit inside their node).
 */
function pictureSpot(n: CanvasNode, img: HTMLImageElement, p: Point): { u: number; v: number } | null {
  const f = frameOf(n);
  const q = rotate({ x: p.x - f.cx, y: p.y - f.cy }, -n.rotation);
  let x = q.x + n.w / 2, y = q.y + n.h / 2;
  const flip = (n.data ?? {}) as MediaData;
  if (n.kind !== "pdf" && flip.flipX) x = n.w - x;
  if (n.kind !== "pdf" && flip.flipY) y = n.h - y;
  let w = n.w, h = n.h;
  if (getComputedStyle(img).objectFit === "contain") {
    const k = Math.min(n.w / img.naturalWidth, n.h / img.naturalHeight);
    w = img.naturalWidth * k;
    h = img.naturalHeight * k;
    x -= (n.w - w) / 2;
    y -= (n.h - h) / 2;
  }
  const u = x / w, v = y / h;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { u, v } : null;
}

/** The color of the pixel under a world point, with what the magnifier needs; null off any picture. */
async function sampleAt(p: Point) {
  const n = pictureAt(p);
  const img = n && shownImage(n);
  const spot = n && img && pictureSpot(n, img, p);
  if (!spot || !img) return null;
  const src = await readable(img.currentSrc || img.src);
  if (!src) return null;
  const px = Math.min(src.w - 1, Math.floor(spot.u * src.w)), py = Math.min(src.h - 1, Math.floor(spot.v * src.h));
  const [r, g, b] = src.ctx.getImageData(px, py, 1, 1).data;
  return { hex: toHex([r, g, b]), url: img.currentSrc || img.src, w: src.w, h: src.h, px, py };
}

// ---------------------------------------------------------------- the eyedropper

export function startPicking(id: string) {
  paletteUi.picking = id;
  paletteUi.loupe = null;
  play("toggleOn", { volume: 0.5 });
}

export function stopPicking() {
  if (!paletteUi.picking) return;
  paletteUi.picking = null;
  paletteUi.loupe = null;
  play("toggleOff", { volume: 0.5 });
}

/** The latest pointer position the magnifier is for; older samples arriving late are dropped. */
let hoverToken = 0;

/** Moves the magnifier: `screen` in viewport px. */
export async function hoverPick(p: Point, screen: Point) {
  const token = ++hoverToken;
  const s = await sampleAt(p);
  if (token !== hoverToken || !paletteUi.picking) return;
  paletteUi.loupe = s && { x: screen.x, y: screen.y, ...s };
}

export function leavePick() {
  hoverToken++;
  paletteUi.loupe = null;
}

/** Adds the color under a world point to the palette being picked for. */
export async function pickAt(p: Point) {
  const id = paletteUi.picking;
  if (!id) return;
  const s = await sampleAt(p);
  if (!s) return play("denied", { volume: 0.4 });
  addColor(id, s.hex);
}

// ---------------------------------------------------------------- extracting

/** A small picture of what a node shows, for extracting colors (the 256 px level; a PDF's page). */
async function pictureUrl(n: CanvasNode): Promise<{ url: string; release(): void } | null> {
  const asset = doc.assetOf(n);
  if (!asset || asset.missing) return null;
  if (n.kind === "video") return { url: backend.posterUrl(asset), release() {} };
  if (n.kind === "pdf") {
    const page = acquirePage(asset, pageOf(n), 256);
    const url = await page.url;
    return url ? { url, release: page.release } : (page.release(), null);
  }
  return { url: backend.assetUrl(asset, 256), release() {} };
}

/** Longest side of the picture colors are extracted from: plenty for dominant colors, and fast. */
const EXTRACT_SIDE = 96;

/** A palette of a picture's dominant colors, placed to its right (in its frame, if it's in one). */
export async function extractPalette(id: string) {
  const n = doc.nodes[id];
  if (!n || !isPicture(n)) return;
  const pic = await pictureUrl(n);
  const src = pic && (await readable(pic.url));
  pic?.release();
  if (!src) return ui.notify("Couldn't read this picture", "warn");
  const k = Math.min(1, EXTRACT_SIDE / Math.max(src.w, src.h));
  const w = Math.max(1, Math.round(src.w * k)), h = Math.max(1, Math.round(src.h * k));
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  const ctx = small.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src.canvas, 0, 0, w, h);
  const colors = extractColors(ctx.getImageData(0, 0, w, h).data);
  if (!colors.length) return ui.notify("No colors found in this picture", "warn");

  const box = aabb(n);
  const name = doc.assetOf(n)?.name.replace(/\.[^.]+$/, "") ?? "";
  const node: CanvasNode = {
    id: crypto.randomUUID(),
    kind: "palette",
    assetId: null,
    x: Math.round(box.x + box.w + 24),
    y: Math.round(box.y),
    w: 360,
    h: 120,
    rotation: 0,
    z: doc.maxZ() + 1,
    data: { ...DEFAULT_PALETTE, title: name, colors: colors.map(newSwatch) } satisfies PaletteData,
  };
  // Joins the picture's frame, if it's in one.
  history.run("Extract palette", [{ type: "addNodes", nodes: [node] }, ...joinOps([node], { x: box.x + box.w / 2, y: box.y + box.h / 2 })]);
  selectOnly([node.id]);
  markFresh([node.id]);
  play("appear", { volume: 0.5 });
}
