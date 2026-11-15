import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { backend } from "./backend";
import { Camera } from "./canvas/camera.svelte";
import { assetSize, packAround } from "./canvas/layout";
import { Doc } from "./doc/document.svelte";
import { bounds, type Point } from "./doc/geometry";
import { History, touchedNodes, type Entry } from "./doc/history.svelte";
import type { Op } from "./doc/ops.svelte";
import type { Asset, BoardSettings, CanvasLink, CanvasNode, ImportResult, ProjectDoc } from "./doc/types";
import { play } from "./juice/sound";
import { deletionSet, joinOps } from "./frame/frames.svelte";
import { probeAudio, probeVideo } from "./media/probe";
import { probePdf } from "./pdf/pdf.svelte";
import { newTextStyle, settings } from "./settings.svelte";
// Used only inside functions, so the import cycle (storage imports this module) is harmless.
import { relinkMissing } from "./storage.svelte";
import { DEFAULT_TEXT } from "./text/palette";

export const doc = new Doc();
export const history = new History(doc);
export const camera = new Camera();
/**
 * Iterate Svelte collections with an explicit `.values()`, never `[...set]`: once the code is
 * hot, JavaScriptCore's JIT (WebKit: WebKitGTK, Safari/WKWebView) spreads a Set subclass without
 * calling its own iterator, which silently drops Svelte's tracking (the selection box froze after
 * a while). `.values()` is a plain method call and always tracks; we use it for every iteration.
 */
export const selection = new SvelteSet<string>();
/** Selected links. Never mixed with selected nodes: selecting one kind clears the other. */
export const linkSelection = new SvelteSet<string>();

/** Nodes changed by undo/redo moments ago, for a wiggle: id → a token that restarts it. */
export const wiggles = new SvelteMap<string, number>();
let wiggleToken = 0;

/** Wiggles the nodes a step touched (not in calm mode). */
function wiggle(entry: Entry) {
  if (settings.calm) return;
  const token = ++wiggleToken;
  for (const id of touchedNodes(entry)) if (doc.nodes[id]) wiggles.set(id, token);
  setTimeout(() => {
    for (const [id, t] of wiggles) if (t === token) wiggles.delete(id);
  }, 500);
}

/** Nodes created moments ago, for the pop-in animation, with each one's stagger delay in ms. */
export const fresh = new SvelteMap<string, number>();

export interface Editing {
  id: string;
  /** Created by this edit: discarded silently if left empty. */
  isNew: boolean;
  original: CanvasNode;
  /** A new node's joining of the frame it was created in: applied, recorded with the node. */
  join?: { ops: Op[]; inverses: Op[] };
}

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface MenuState {
  /** Client coordinates. */
  x: number;
  y: number;
  /** World point that was clicked. */
  world: Point;
  /** Right-click on the canvas or a node, or the board pill's menu. */
  /** "table": a table cell's menu (the cell is `tableUi.cell`). */
  /** "swatch": a palette swatch's menu (the swatch is `paletteUi.swatch`). */
  /** "sprite": a sprite's tag or layers menu, from its bar (`spriteUi.menu`). */
  /** "timer": a countdown's lengths and modes, from its card (`timerUi.menu`). */
  /** "add": the quick-add menu (N), every kind of node to add at `world`. */
  target: "canvas" | "selection" | "board" | "table" | "swatch" | "sprite" | "timer" | "templates" | "add";
}

class Ui {
  dropHover = $state(false);
  toast = $state<{ text: string; id: number; action?: ToastAction } | null>(null);
  /** Something long running (a search for missing files): shown in a card with a Stop button. */
  task = $state<{ title: string; detail: string; folder?: string; stop?: () => void } | null>(null);
  editing = $state<Editing | null>(null);
  /** A link whose label is being edited, with the label it had before. */
  editingLink = $state<{ id: string; original: string } | null>(null);
  menu = $state<MenuState | null>(null);
  settingsOpen = $state(false);
  /** The side panel's open tab, or null when it's closed. */
  panel = $state<"outline" | "tasks" | "history" | null>(null);
  /** Nodes to point out on the canvas (hovering a history entry). */
  highlight = $state.raw<Set<string>>(new Set());
  shortcutsOpen = $state(false);
  /** The status bar's list of pins. */
  pinsOpen = $state(false);
  /** The clean view (Tab): the toolbar, board pill, status bar and side panel are hidden. */
  chromeHidden = $state(false);
  /** Last pointer position over the canvas, client coordinates; null when outside it. */
  pointer: { x: number; y: number } | null = null;
  #toastTimer = 0;

  /** A message at the bottom; with an action, a button in it and a longer stay. */
  notify(text: string, tone: "info" | "warn" = "info", action?: ToastAction) {
    if (tone === "warn") play("caution");
    clearTimeout(this.#toastTimer);
    this.toast = { text, id: Math.random(), action };
    this.#toastTimer = window.setTimeout(() => (this.toast = null), action ? 7000 : 2600);
  }

  dismissToast() {
    clearTimeout(this.#toastTimer);
    this.toast = null;
  }
}
export const ui = new Ui();

const DEFAULT_BOARD: BoardSettings = { embedNew: false };

class Project {
  path = $state<string | null>(null);
  board = $state<BoardSettings>({ ...DEFAULT_BOARD });
  name = $derived(this.path ? this.path.split(/[\\/]/).pop()!.replace(/\.patchwork$/, "") : "Untitled");
}
export const project = new Project();

// ---------------------------------------------------------------- editing

export function importDropped(clientX: number, clientY: number, result: ImportResult, viewport: DOMRect) {
  void placeAssets(result, camera.toWorld(clientX - viewport.left, clientY - viewport.top));
}

/**
 * Video, audio and PDFs new to this board are probed by the webview: videos get their size (and
 * a poster), PDFs their first page's size, and files it can't play or open are dropped. Returns
 * the usable assets, in order.
 */
async function probeNew(assets: Asset[]): Promise<{ assets: Asset[]; unplayable: number; unopenable: number }> {
  const probe = (a: Asset) => (a.kind === "video" ? probeVideo(a) : a.kind === "audio" ? probeAudio(a) : probePdf(a));
  const probed = await Promise.all(
    assets.map(async (a) => {
      if ((a.kind !== "video" && a.kind !== "audio" && a.kind !== "pdf") || doc.assets[a.id]) return a;
      const p = await probe(a);
      return p && { ...a, width: p.width, height: p.height };
    }),
  );
  const usable = probed.filter((a): a is Asset => a !== null);
  const unopenable = assets.filter((a, i) => a.kind === "pdf" && !probed[i]).length;
  return { assets: usable, unplayable: assets.length - usable.length - unopenable, unopenable };
}

const plural = (n: number, word: string) => (n === 1 ? `1 ${word}` : `${n} ${word}s`);

/** "Add image", "Add 3 videos", "Add text file", "Add 5 files". */
function addLabel(assets: Asset[], texts = 0) {
  const kinds = new Set(assets.map((a) => (a.kind === "gif" ? "image" : a.kind)));
  if (texts) {
    if (!assets.length) return texts === 1 ? "Add text file" : `Add ${texts} text files`;
    return `Add ${assets.length + texts} files`;
  }
  const kind = kinds.size > 1 ? "file" : ([...kinds][0] ?? "file");
  const noun = kind === "pdf" ? "PDF" : kind;
  if (assets.length === 1) return `Add ${noun}`;
  return `Add ${assets.length} ${noun === "audio" ? "audio files" : noun + "s"}`;
}

/**
 * A text card for a dropped .md or .txt file. Its height is measured once it renders; packing
 * uses an estimate from the text's length (about 0.55 em per character).
 */
function textCard(text: string): CanvasNode {
  const md = text.replace(/\r\n?/g, "\n").trim();
  const fontSize = settings.textSize;
  const w = md.length > 280 ? 480 : 320;
  const perLine = Math.max(1, (w - fontSize * 1.4) / (fontSize * 0.55));
  const lines = md.split("\n").reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return {
    id: crypto.randomUUID(),
    kind: "text",
    assetId: null,
    x: 0,
    y: 0,
    w,
    h: Math.min(4000, lines * fontSize * 1.45 + fontSize),
    rotation: 0,
    z: 0,
    data: { ...DEFAULT_TEXT, ...newTextStyle(), md },
  };
}

/**
 * Adds a node per imported asset (and a text card per text file), packed around `center`
 * (world), as one undo step. On a board set to embed new images, linked files are embedded first.
 */
export async function placeAssets(result: ImportResult, center: Point, label?: string) {
  if (result.skipped.length) {
    ui.notify(`Skipped ${plural(result.skipped.length, "unsupported file")}`, "warn");
  }
  const cards = (result.texts ?? []).filter((t) => t.text.trim()).map((t) => textCard(t.text));
  if (!result.assets.length && !cards.length) return;
  const { assets, unplayable, unopenable } = await probeNew(result.assets);
  if (unplayable) ui.notify(`Skipped ${plural(unplayable, "file")} this system can't play`, "warn");
  if (unopenable) ui.notify(`Skipped ${plural(unopenable, "PDF")} that couldn't be opened`, "warn");
  if (!assets.length && !cards.length) return;
  result = { ...result, assets };
  if (project.board.embedNew && result.assets.some((a) => a.storage === "linked" && !doc.assets[a.id])) {
    try {
      result = { ...result, assets: await backend.packAssets(result.assets) };
    } catch (e) {
      ui.notify(`Couldn't embed: ${e}`, "warn");
    }
  }

  for (const asset of result.assets) doc.assets[asset.id] ??= asset;

  const sizes = [...result.assets.map(assetSize), ...cards.map((c) => ({ w: c.w, h: c.h }))];
  const positions = packAround(center.x, center.y, sizes);
  let z = doc.maxZ();
  const media: CanvasNode[] = result.assets.map((asset, i) => ({
    id: crypto.randomUUID(),
    kind: asset.kind,
    assetId: asset.id,
    ...positions[i],
    ...sizes[i],
    rotation: 0,
    z: 0,
  }));
  const texts = cards.map((c, i) => ({ ...c, ...positions[media.length + i] }));
  const nodes = [...media, ...texts].map((n) => ({ ...n, z: ++z }));

  history.run(label ?? addLabel(result.assets, texts.length), [{ type: "addNodes", nodes }, ...joinOps(nodes, center)]);
  selectOnly(nodes.map((n) => n.id));
  markFresh(nodes.map((n) => n.id));
}

const STAGGER = 28;
const MAX_STAGGER = 420;
const MAX_POPS = 6;

/** Pops these nodes in, one after another, each with a rising blip. */
export function markFresh(ids: string[]) {
  const step = settings.calm ? 0 : Math.min(STAGGER, MAX_STAGGER / ids.length);
  ids.forEach((id, i) => fresh.set(id, i * step));
  const pops = settings.calm ? 1 : Math.min(ids.length, MAX_POPS);
  const spacing = (step * ids.length) / pops;
  for (let i = 0; i < pops; i++) play("appear", { delay: i * spacing, pitch: 1 + i * 0.06 });
  setTimeout(() => ids.forEach((id) => fresh.delete(id)), 700 + step * ids.length);
}

/**
 * Where something created from the keyboard or a paste lands: an explicit point (a context
 * menu's), else under the pointer when it's over the canvas, else the middle of the view.
 */
export function placementPoint(at?: Point): Point {
  if (at) return at;
  const viewport = document.querySelector(".viewport")?.getBoundingClientRect();
  if (ui.pointer && viewport) return camera.toWorld(ui.pointer.x - viewport.left, ui.pointer.y - viewport.top);
  return camera.toWorld(camera.centerX, camera.height / 2);
}

export function selectedNodes(): CanvasNode[] {
  return [...selection.values()].map((id) => doc.nodes[id]).filter((n) => n !== undefined);
}

export function selectOnly(ids: Iterable<string>) {
  selection.clear();
  linkSelection.clear();
  for (const id of ids) selection.add(id);
}

export function selectLinks(ids: Iterable<string>) {
  selection.clear();
  linkSelection.clear();
  for (const id of ids) linkSelection.add(id);
}

export function selectedLinks(): CanvasLink[] {
  return [...linkSelection.values()].map((id) => doc.links[id]).filter((l) => l !== undefined);
}

export function clearSelection() {
  selection.clear();
  linkSelection.clear();
}

/**
 * Deletes the selected nodes (with their links) or the selected links; `ids` deletes those nodes
 * instead (cutting a parent with its children). Locked nodes stay.
 */
export function deleteSelection(verb = "Delete", ids: Iterable<string> = selection.values()) {
  // A frame goes with its contents; a frame emptied by this goes too.
  const all = deletionSet(ids);
  const nodes = all.filter((id) => !doc.nodes[id]?.locked);
  const kept = all.length - nodes.length;
  if (kept) ui.notify(kept > 1 ? `${kept} locked nodes kept` : "1 locked node kept");
  const links = [...linkSelection.values()];
  if (!nodes.length && !links.length) {
    if (kept) play("denied", { volume: 0.5 });
    return;
  }
  const ops: Op[] = [];
  if (links.length) ops.push({ type: "removeLinks", ids: links });
  if (nodes.length) ops.push({ type: "removeNodes", ids: nodes });
  const [count, noun] = nodes.length ? [nodes.length, "node"] : [links.length, "link"];
  history.run(count > 1 ? `${verb} ${count} ${noun}s` : `${verb} ${noun}`, ops);
  clearSelection();
  play("vanish");
}

/** Drops ids that no longer exist (after undo/redo). */
function pruneSelection() {
  for (const id of selection.values()) if (!doc.nodes[id]) selection.delete(id);
  for (const id of linkSelection.values()) if (!doc.links[id]) linkSelection.delete(id);
}

export function undo() {
  const entry = history.undo();
  if (entry) {
    ui.notify(`Undo: ${entry.label}`);
    wiggle(entry);
  }
  pruneSelection();
}

export function redo() {
  const entry = history.redo();
  if (entry) {
    ui.notify(`Redo: ${entry.label}`);
    wiggle(entry);
  }
  pruneSelection();
}

let jumping = 0;

/**
 * Undoes or redoes until `position` steps are applied (0: the start), playing the steps out
 * quickly with a tick each: about 70 ms apiece, faster for long jumps, never much over half a
 * second in all. A new jump takes over from one in progress.
 */
export async function jumpTo(position: number) {
  const token = ++jumping;
  const steps = Math.abs(position - history.position);
  if (!steps) return;
  const back = position < history.position;
  const delay = settings.calm ? 0 : Math.min(70, 560 / steps);
  for (let i = 0; i < steps && token === jumping; i++) {
    const entry = back ? history.undo() : history.redo();
    if (!entry) break;
    wiggle(entry);
    play("tap", { volume: 0.4, throttle: 25, pitch: back ? 0.95 - (i / steps) * 0.2 : 1.05 + (i / steps) * 0.2 });
    pruneSelection();
    if (delay && i < steps - 1) await new Promise((r) => setTimeout(r, delay));
  }
  if (token === jumping) play("swipe", { volume: 0.5, pitch: back ? 0.85 : 1.15 });
}

/** Frames the selection, or everything when nothing is selected. */
export function frameContent() {
  const ends = selectedLinks().flatMap((l) => [l.from, l.to]);
  const nodes = selection.size
    ? [...selection.values()].map((id) => doc.nodes[id])
    : ends.length
      ? ends.map((id) => doc.nodes[id])
      : doc.nodeList;
  const rect = bounds(nodes.filter(Boolean));
  if (rect) camera.frame(rect, { maxZoom: selection.size || ends.length ? 4 : 1 });
}

// ---------------------------------------------------------------- files

/** The board as it's saved (also what a recovery copy holds). */
export function snapshot(): ProjectDoc {
  return {
    camera: camera.state,
    assets: $state.snapshot(doc.usedAssets()),
    // A parent that was deleted isn't saved.
    nodes: $state.snapshot(doc.nodeList).map(({ parent, ...n }) => ({ ...n, data: n.data ?? null, ...(parent && doc.nodes[parent] ? { parent } : {}) })),
    links: $state.snapshot(doc.linkList).map((l) => ({ ...l, data: l.data ?? null })),
    // Runs of timers that were deleted aren't kept.
    board: { ...$state.snapshot(project.board), timers: Object.fromEntries(Object.entries($state.snapshot(project.board.timers) ?? {}).filter(([id]) => doc.nodes[id])) },
  };
}

/**
 * Saves the board (asking where for a new one, or with `saveAs`). `quiet` (autosave) skips the
 * toast and the sound. Changes made while the file was being written stay unsaved.
 */
export async function save(saveAs = false, { quiet = false } = {}): Promise<boolean> {
  const path = !project.path || saveAs ? await backend.pickSavePath(project.path) : project.path;
  if (!path) return false;
  const version = history.version;
  try {
    await backend.saveProject(path, snapshot());
    project.path = path;
    if (history.version === version) history.markSaved();
    settings.addRecent(path);
    if (!quiet) {
      ui.notify("Saved");
      play("done");
    }
    return true;
  } catch (e) {
    ui.notify(`Save failed: ${e}`, "warn");
    return false;
  }
}

/** Asks before discarding unsaved changes. True means it's fine to proceed (their recovery copy goes too). */
export async function confirmDiscard(): Promise<boolean> {
  if (!history.dirty) return true;
  const ok = await backend.confirm(`Discard unsaved changes to “${project.name}”?`, "Unsaved changes");
  if (ok) discarded.forEach((f) => f());
  return ok;
}

/** Run when the user discards unsaved changes (recovery deletes the board's copy). */
export const discarded: (() => void)[] = [];

export async function open() {
  if (!(await confirmDiscard())) return;
  const path = await backend.pickOpenPath();
  if (path) await load(path);
}

/** Opens a board by path (e.g. from the recent list). */
export async function openPath(path: string) {
  if (await confirmDiscard()) await load(path);
}

/** Puts a loaded board (from its file, or a recovery copy) on screen. */
export function showBoard(loaded: ProjectDoc, path: string | null) {
  ui.editing = null;
  ui.editingLink = null;
  ui.menu = null;
  doc.replace(loaded.assets, loaded.nodes, loaded.links ?? []);
  clearSelection();
  history.clear();
  camera.set(loaded.camera);
  project.path = path;
  project.board = { ...DEFAULT_BOARD, ...loaded.board };
}

async function load(path: string) {
  try {
    const loaded = await backend.loadProject(path);
    showBoard(loaded, path);
    settings.addRecent(path);
    const missing = loaded.assets.filter((a) => a.missing).length;
    if (missing) {
      ui.notify(`${missing} linked file${missing > 1 ? "s are" : " is"} missing`, "warn", { label: "Find…", run: () => void relinkMissing() });
    }
  } catch (e) {
    ui.notify(`Could not open: ${e}`, "warn");
    // A board that moved or was deleted shouldn't linger in the recent list.
    if (/no such file|cannot find|not found|unable to open/i.test(String(e))) settings.forgetRecent(path);
  }
}

export async function newProject() {
  if (!(await confirmDiscard())) return;
  ui.editing = null;
  ui.editingLink = null;
  ui.menu = null;
  doc.replace([], [], []);
  clearSelection();
  history.clear();
  camera.set({ x: camera.width / 2, y: camera.height / 2, zoom: 1 });
  project.path = null;
  project.board = { ...DEFAULT_BOARD };
}
