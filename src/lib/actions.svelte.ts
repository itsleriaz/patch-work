import {
  AArrowDown,
  AArrowUp,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  ArrowRightLeft,
  BookOpen,
  BringToFront,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Ellipsis,
  Eraser,
  FilePlus2,
  FlipHorizontal2,
  FlipVertical2,
  Focus,
  ZoomIn,
  SquarePlus,
  ZoomOut,
  FolderOpen,
  FolderInput,
  FolderOutput,
  FolderSearch,
  FolderSync,
  Gauge,
  Package,
  PackageOpen,
  Leaf,
  Map as MapIcon,
  EyeOff,
  MapPin,
  MapPinned,
  MapPinPen,
  MapPinPlus,
  Navigation,
  LayoutGrid,
  ListChecks,
  ALargeSmall,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FoldHorizontal,
  Frame,
  History as HistoryIcon,
  ListMinus,
  Search as SearchIcon,
  Table as TableIcon,
  ListTodo,
  ListTree,
  Keyboard,
  Proportions,
  UnfoldHorizontal,
  UnfoldVertical,
  Shrink,
  SquareDashedTopSolid,
  Ungroup,
  SquareDashedMousePointer,
  Stamp,
  ImageUp,
  ArrowUpDown,
  Move,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  LayoutTemplate,
  LogOut,
  FoldVertical,
  ListOrdered,
  CircleMinus,
  CircleOff,
  CirclePlus,
  Goal,
  Hash,
  Castle,
  DoorClosed,
  SquareDashed,
  Brush,
  Stamp as StampIcon,
  Route as RouteIcon,
  SquareSlash,
  Trees as TreesIcon,
  BrickWall,
  Highlighter,
  Pen,
  Palette as PaletteIcon,
  Lock as LockIcon,
  LockOpen,
  Plug,
  Unplug,
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Strikethrough as StrikeIcon,
  Code as CodeIcon,
  Link as LinkIcon,
  Pilcrow,
  Heading1,
  Heading2,
  Heading3,
  List as ListIcon,
  TextQuote,
  RemoveFormatting,
  Timer as TimerIcon,
  Flag,
  ImageDown,
  Pipette,
  Plus,
  SwatchBook,
  PenLine,
  Footprints,
  RotateCcwSquare,
  Maximize,
  Minus,
  MoveHorizontal,
  MoveRight,
  Pencil,
  Play as PlayIcon,
  Redo2,
  Repeat,
  RotateCcw,
  RotateCw,
  Save,
  SaveAll,
  Scissors,
  SendToBack,
  Settings,
  Magnet,
  Network,
  Spline,
  Waypoints,
  Tag,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
  Type,
  Undo2,
  Volume2,
} from "@lucide/svelte";
import { MAX_ZOOM, MIN_ZOOM } from "./canvas/camera.svelte";
import { isTemplate, templateList, toggleTemplate } from "./frame/templates.svelte";
import { paletteData } from "./palette/model";
import type { Component } from "svelte";
import type { TipContent } from "./ui/tips.svelte";
import {
  camera,
  clearSelection,
  deleteSelection,
  doc,
  frameContent,
  fresh,
  history,
  linkSelection,
  markFresh,
  newProject,
  open,
  placementPoint,
  project,
  redo,
  save,
  selectedLinks,
  selectedNodes,
  selection,
  selectLinks,
  selectOnly,
  ui,
  undo,
} from "./app.svelte";
import { backend } from "./backend";
import { copySelection, pasteFromMenu } from "./clipboard.svelte";
import { collectFiles, hasEmbedded, hasLinked, hasMissing, packBoard, relinkMissing, toggleEmbedNew, unpackBoard } from "./storage.svelte";
import { isMac, isWindows } from "./platform";
import { assetSize, GRID, snap } from "./canvas/layout";
import { MIN_TEXT_WIDTH } from "./canvas/interaction.svelte";
import { DEFAULT_TABLE } from "./table/model";
import { createTable } from "./table/table.svelte";
import { openSearch } from "./search/search.svelte";
import { lineUp, pack, stack, type Box, type Edge, type Offsets } from "./canvas/arrange";
import { isPlayable, loops, playing } from "./media/playback.svelte";
import { aabb, bounds, frameOf, normalizeDeg, type Point } from "./doc/geometry";
import { crop } from "./canvas/crop.svelte";
import { MAP_STYLES, mapData } from "./map/model";
import { canSlot, slotOf, type SlotMode } from "./canvas/slot";
import { applyOp, type LinkChange, type NodeChange, type Op } from "./doc/ops.svelte";
import type { CanvasLink, CanvasNode, LinkArrow, LinkColor, LinkData, LinkShape, LinkSide, MediaData, TextAlign, TextColor } from "./doc/types";
import { linkData, newLinkData } from "./links/palette";
import { checklistData, DEFAULT_CHECKLIST, isEmpty, newTask, pruneEmpty } from "./checklist/model";
import { checklistUi } from "./checklist/state.svelte";
import { fontSizeOf, isFlow, withFontSize } from "./canvas/flow";
import { count, counterUi, setCounter } from "./counter/count.svelte";
import { carryMembers, createFrame, frameSelection, frameUi, joinOps, membersOf, removeFromFrame, remapFrame, toggleCollapse, toggleFit, ungroup, withMembers, frames } from "./frame/frames.svelte";
import { frameData } from "./frame/model";
import { counterData, DEFAULT_COUNTER } from "./counter/model";
import { goToPage, pagesOf, spreadPages, stepPage } from "./pdf/pages.svelte";
import { drawUi, enterDraw, exitDraw, isDrawing, setTool, stepSize, toggleDraw } from "./drawing/draw.svelte";
import { createPalette, editColor, extractPalette, isPalette, paletteUi, sortColors, startPicking, stopPicking } from "./palette/palette.svelte";
import { createMap, enterMap, exitMap, isMap, mapUi, setMapStyle, setMapTool, styledMap, toggleMapGrid } from "./map/map.svelte";
import { isPin, pinData } from "./pin/model";
import { isExportable, openExport } from "./export/export.svelte";
import { format, formatting, isActive, openLinkBar, toggleHeading } from "./text/format.svelte";
import { isSprite } from "./sprite/model";
import { isTimer, timerData } from "./timer/model";
import { createTimer, isRunning, lapTimer, resetTimer, timerUi, toggleTimer } from "./timer/timers.svelte";
import { spriteUi, stepSprite, toggleSprite } from "./sprite/sprites.svelte";
import { attachToParent, canAttach, canDetach, carryChildren, detachFromParent, remapParent, withFamily } from "./parent/parents.svelte";
import { createPin, freeSlot, jumpToPin, pins, pinUi, pinView, stepPin, withFreeSlots } from "./pin/pins.svelte";
import { play, playCue, type Cue } from "./juice/sound";
import { newTextStyle, settings } from "./settings.svelte";
import { DEFAULT_TEXT, MAX_FONT, MIN_FONT, textData } from "./text/palette";
import ShapeCurve from "./ui/icons/ShapeCurve.svelte";
import ShapeElbow from "./ui/icons/ShapeElbow.svelte";
import ShapeStraight from "./ui/icons/ShapeStraight.svelte";

// ---------------------------------------------------------------- helpers

/** Nodes showing a picture: they flip and have a native size. */
const isVisual = (n: CanvasNode) => n.kind === "image" || n.kind === "gif" || n.kind === "video" || n.kind === "sprite";
const isPdf = (n: CanvasNode) => n.kind === "pdf";
/** Pictures with a size of their own: they normalize and have a native size. */
const isPicture = (n: CanvasNode) => isVisual(n) || isPdf(n);
/** Selected PDFs with pages to turn (and nothing else selected). */
const turnable = () => all(isPdf) && selectedNodes().some((n) => (pagesOf(n) ?? 0) > 1);
/** Nodes backed by a file. */
const hasFile = (n: CanvasNode) => n.assetId !== null;
const isText = (n: CanvasNode) => n.kind === "text";
const isChecklist = (n: CanvasNode) => n.kind === "checklist";
const isCounter = (n: CanvasNode) => n.kind === "counter";
const isFrameNode = (n: CanvasNode) => n.kind === "frame";
/** The one selected counter, if that's the selection. */
const theCounter = () => (single(isCounter) ? selectedNodes()[0] : undefined);

/** True when something is selected and every selected node matches. */
function all(pred: (n: CanvasNode) => boolean) {
  const nodes = selectedNodes();
  return nodes.length > 0 && nodes.every(pred);
}

const single = (pred: (n: CanvasNode) => boolean = () => true) => selection.size === 1 && all(pred);
const multi = () => selection.size > 1;
const any = () => selection.size > 0;
const anyLinks = () => linkSelection.size > 0;
const singleLink = () => linkSelection.size === 1 && selectedLinks().length === 1;
/** Every selected link matches (and at least one is selected). */
const allLinks = (pred: (l: CanvasLink) => boolean) => {
  const links = selectedLinks();
  return links.length > 0 && links.every(pred);
};

/** The selected nodes that can be moved, resized and rotated: the unlocked ones. */
const free = () => selectedNodes().filter((n) => !n.locked);
/** True when some selected nodes are unlocked and all of those match. */
function allFree(pred: (n: CanvasNode) => boolean) {
  const nodes = free();
  return nodes.length > 0 && nodes.every(pred);
}

/** Applies a per-node change to the selection as one undoable step. */
const updateSelected = (label: string, fn: (n: CanvasNode) => NodeChange["props"] | null, carry = false) =>
  updateNodes(label, selectedNodes(), fn, carry);
/** The same for changes to geometry (moves, sizes, turns, flips), which leave locked nodes alone. */
/** Children follow these changes. */
const updateFree = (label: string, fn: (n: CanvasNode) => NodeChange["props"] | null, carry = false) =>
  updateNodes(label, free(), fn, carry, true);

function updateNodes(label: string, nodes: CanvasNode[], fn: (n: CanvasNode) => NodeChange["props"] | null, carry: boolean, family = false) {
  let changes: NodeChange[] = [];
  for (const n of nodes) {
    const props = fn(n);
    if (props) changes.push({ id: n.id, props });
  }
  if (!changes.length) return;
  // Moving a frame (align, tidy) takes what's in it along, and a parent its children.
  if (carry) changes = carryMembers(changes);
  if (family) changes = carryChildren(changes);
  history.run(label, [{ type: "updateNodes", changes }]);
}

const mediaData = (n: CanvasNode) => (n.data ?? {}) as MediaData;

// ---------------------------------------------------------------- text editing

/**
 * Adds a node that's recorded later (when its edit ends), joining the frame under `at` now so an
 * auto-fit frame grows around it while it's typed into.
 */
function addUnrecorded(node: CanvasNode, at: Point) {
  applyOp(doc, { type: "addNodes", nodes: [node] });
  const ops = joinOps([node], at);
  const inverses = ops.map((op) => applyOp(doc, op));
  selectOnly([node.id]);
  markFresh([node.id]);
  return ops.length ? { ops, inverses } : undefined;
}

export function createText(at: Point) {
  const node: CanvasNode = {
    id: crypto.randomUUID(),
    kind: "text",
    assetId: null,
    x: snap(at.x),
    y: snap(at.y - settings.textSize),
    w: 320,
    h: 40,
    rotation: 0,
    z: doc.maxZ() + 1,
    // The "New text" card color preference is written into the card.
    data: { ...DEFAULT_TEXT, ...newTextStyle() },
  };
  // Not recorded yet: an edit that ends empty leaves no trace in history.
  const join = addUnrecorded(node, at);
  ui.editing = { id: node.id, isNew: true, original: node, join };
}

/** A new checklist with one empty task, being edited. Like a new text card, it's recorded only once it has content. */
export function createChecklist(at: Point) {
  const task = newTask();
  const node: CanvasNode = {
    id: crypto.randomUUID(),
    kind: "checklist",
    assetId: null,
    x: snap(at.x),
    y: snap(at.y - DEFAULT_CHECKLIST.fontSize),
    w: 300,
    h: 80,
    rotation: 0,
    z: doc.maxZ() + 1,
    data: { ...DEFAULT_CHECKLIST, items: [task] },
  };
  const join = addUnrecorded(node, at);
  checklistUi.focus = { nodeId: node.id, itemId: task.id };
  ui.editing = { id: node.id, isNew: true, original: node, join };
}

/** A new counter at 0, its label ready to type. */
export function createCounter(at: Point) {
  const node: CanvasNode = {
    id: crypto.randomUUID(),
    kind: "counter",
    assetId: null,
    x: snap(at.x - 110),
    y: snap(at.y - 40),
    w: 220,
    h: 110,
    rotation: 0,
    z: doc.maxZ() + 1,
    data: { ...DEFAULT_COUNTER },
  };
  history.run("Add counter", [{ type: "addNodes", nodes: [node] }, ...joinOps([node], at)]);
  selectOnly([node.id]);
  markFresh([node.id]);
  counterUi.editing = { nodeId: node.id, field: "label" };
}

/** Edits a text card's Markdown or a checklist's tasks. */
export function startEdit(id: string) {
  const node = doc.nodes[id];
  if (!node || !(isText(node) || isChecklist(node))) return;
  selectOnly([id]);
  ui.editing = { id, isNew: false, original: $state.snapshot(node) };
  // Make tiny text legible before typing into it.
  const size = fontSizeOf(node);
  if (size * camera.zoom < 10) camera.frame(aabb(node), { maxZoom: (14 / size) * 1.2 });
}

/** Ends any inline edit: a text card's Markdown or a link's label. */
export function commitEdit() {
  commitLinkLabel();
  const editing = ui.editing;
  if (!editing) return;
  ui.editing = null;
  const { id, isNew, original, join } = editing;
  const node = doc.nodes[id];
  if (!node) return;

  const checklist = node.kind === "checklist";
  const noun = checklist ? "checklist" : "text";
  if (checklist) {
    // Tasks left empty go away; so does a checklist with nothing typed in it.
    const data = checklistData($state.snapshot(node.data));
    node.data = { ...data, items: pruneEmpty(data.items) };
  }
  const empty = checklist ? isEmpty(checklistData(node.data)) : textData(node.data).md.trim() === "";
  if (empty) {
    applyOp(doc, { type: "removeNodes", ids: [id] });
    // Undo joining a frame too (in reverse order), as if the card never existed.
    if (isNew && join) for (const op of [...join.inverses].reverse()) applyOp(doc, op);
    selection.delete(id);
    if (!isNew) {
      history.record(`Delete ${noun}`, [{ type: "removeNodes", ids: [id] }], [{ type: "addNodes", nodes: [original] }]);
    }
    return;
  }
  if (isNew) {
    // A card dragged out of a link handle arrives with its link: one step adds both.
    const links = doc.linksOf([id]).map((l) => $state.snapshot(l) as CanvasLink);
    const forward: Op[] = [{ type: "addNodes", nodes: [$state.snapshot(node)] }, ...(join?.ops ?? [])];
    if (links.length) forward.push({ type: "addLinks", links });
    history.record(links.length ? `Add linked ${noun}` : `Add ${noun}`, forward, [{ type: "removeNodes", ids: [id] }, ...(join?.inverses ?? [])]);
  } else if (JSON.stringify($state.snapshot(node.data)) !== JSON.stringify(original.data ?? null)) {
    history.record(
      `Edit ${noun}`,
      [{ type: "updateNodes", changes: [{ id, props: { data: $state.snapshot(node.data), h: node.h } }] }],
      [{ type: "updateNodes", changes: [{ id, props: { data: original.data, h: original.h } }] }],
    );
  }
}

export function setTextColor(color: TextColor) {
  play("button", { volume: 0.5 });
  updateSelected("Text color", (n) => (isText(n) ? { data: { ...textData(n.data), color } } : null));
}

function setTextAlign(align: TextAlign) {
  updateSelected("Text alignment", (n) => (isText(n) ? { data: { ...textData(n.data), align } } : null));
}

function scaleFont(factor: number) {
  updateFree("Font size", (n) => {
    if (!isFlow(n)) return null;
    const fontSize = Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(fontSizeOf(n) * factor)));
    return { data: withFontSize(n, fontSize) };
  });
}

/** A flowing card's default font size, by kind. */
const defaultFont = (n: CanvasNode) =>
  n.kind === "checklist" ? DEFAULT_CHECKLIST.fontSize : n.kind === "counter" ? DEFAULT_COUNTER.fontSize : n.kind === "table" ? DEFAULT_TABLE.fontSize : settings.textSize;

/** Back to the default text size; the width scales with it, so the card keeps its shape. */
function resetFont() {
  updateFree("Default text size", (n) => {
    if (!isFlow(n)) return null;
    const size = fontSizeOf(n), def = defaultFont(n);
    if (size === def) return null;
    return { data: withFontSize(n, def), w: Math.max(MIN_TEXT_WIDTH, n.w * (def / size)) };
  });
}

/**
 * Fixed height: a text card keeps its current height and scrolls what doesn't fit. Turning it off
 * lets the height follow the content again (the card measures itself).
 */
function toggleFixedHeight() {
  const nodes = free().filter(isText);
  if (!nodes.length) return;
  const on = !nodes.every((n) => textData(n.data).fixed);
  const changes: NodeChange[] = nodes.map((n) => ({ id: n.id, props: { data: { ...textData($state.snapshot(n.data)), fixed: on } } }));
  history.run(on ? "Fixed height" : "Height follows text", [{ type: "updateNodes", changes }]);
}

/**
 * Shrinks text cards to their longest line, so there's no empty space on the right. Measured on
 * a hidden copy of the rendered card laid out at its natural width. Cards never grow.
 */
function fitTextWidth() {
  updateFree("Fit width", (n) => {
    if (!isText(n)) return null;
    const box = document.querySelector<HTMLElement>(`[data-node-id="${n.id}"] .text`);
    if (!box?.parentElement) return null;
    const copy = box.cloneNode(true) as HTMLElement;
    Object.assign(copy.style, { position: "absolute", visibility: "hidden", width: "max-content", left: "0", top: "0" });
    box.parentElement.appendChild(copy);
    const natural = copy.offsetWidth;
    copy.remove();
    const w = Math.max(MIN_TEXT_WIDTH, Math.min(n.w, Math.ceil(natural) + 1));
    if (Math.abs(w - n.w) < 0.5) return null;
    // A rotated card keeps its center; an upright one its left edge.
    return n.rotation ? { w, x: n.x + (n.w - w) / 2 } : { w };
  });
}

// ---------------------------------------------------------------- arrange

/** Locks these nodes (the selection by default), or unlocks them. */
export function setLocked(on: boolean, of = selectedNodes()) {
  const nodes = of.filter((n) => !!n.locked !== on);
  if (!nodes.length) return;
  const changes: NodeChange[] = nodes.map((n) => ({ id: n.id, props: { locked: on || undefined } }));
  const what = nodes.length > 1 ? `${nodes.length} nodes` : "node";
  history.run(`${on ? "Lock" : "Unlock"} ${what}`, [{ type: "updateNodes", changes }]);
}

function duplicate() {
  // Frames bring their members along, parents their children.
  const nodes = withFamily(withMembers(selection.values())).map((id) => doc.nodes[id]).filter(Boolean).sort((a, b) => a.z - b.z);
  if (!nodes.length) return;
  let z = doc.maxZ();
  const ids = new Map(nodes.map((n) => [n.id, crypto.randomUUID()]));
  // Copied pins take free numbers (or are left out when all nine are taken).
  const copies = withFreeSlots(nodes.map((n) => ({
    ...remapParent(remapFrame($state.snapshot(n) as CanvasNode, ids), ids),
    id: ids.get(n.id)!,
    x: n.x + GRID * 2,
    y: n.y + GRID * 2,
    z: ++z,
  })));
  if (!copies.length) return;
  const links = remapLinks(doc.linksWithin(ids.keys()), ids);
  history.run(copies.length > 1 ? `Duplicate ${copies.length} nodes` : "Duplicate", [
    { type: "addNodes", nodes: copies },
    ...joinOps(copies),
    { type: "addLinks", links },
  ]);
  selectOnly(copies.map((c) => c.id));
  markFresh(copies.map((c) => c.id));
}

/** Pins are always on top, so stacking leaves them out. */
const canRestack = () => selectedNodes().some((n) => !isPin(n));

function restack(toFront: boolean) {
  const nodes = selectedNodes().sort((a, b) => a.z - b.z);
  const others = doc.nodeList.filter((n) => !selection.has(n.id));
  const base = toFront
    ? Math.max(0, ...others.map((n) => n.z))
    : Math.min(0, ...others.map((n) => n.z)) - nodes.length - 1;
  const z = new Map(nodes.map((n, i) => [n.id, base + i + 1]));
  updateSelected(toFront ? "Bring to front" : "Send to back", (n) => ({ z: z.get(n.id)! }));
}

/**
 * The selected nodes that arrange commands place: members of selected frames are left out, since
 * they move with their frame (`carryMembers`). Pins mark places, so they stay where they are.
 */
function arrangeable(): CanvasNode[] {
  return free().filter((n) => {
    const owner = frames.owner.get(n.id);
    return !isPin(n) && !(owner && selection.has(owner));
  });
}
const canArrange = () => arrangeable().length > 1;

/** Moves arranged nodes by offsets (frames take their contents along), as one undo step. */
function applyOffsets(label: string, offsets: Offsets) {
  updateFree(label, (n) => {
    const o = offsets.get(n.id);
    return o ? { x: n.x + o.dx, y: n.y + o.dy } : null;
  }, true);
}

const boxes = (nodes: CanvasNode[]): Box[] => nodes.map((n) => ({ id: n.id, ...aabb(n) }));

/** Edges stack the nodes against that edge (no overlaps, `settings.arrangeGap` apart); centers line them up. */
function align(edge: Edge | "hcenter" | "vcenter") {
  const nodes = arrangeable();
  if (edge !== "hcenter" && edge !== "vcenter") return applyOffsets("Align", stack(boxes(nodes), edge, settings.arrangeGap));
  const b = bounds(nodes);
  if (!b) return;
  const offsets: Offsets = new Map();
  for (const n of nodes) {
    const r = aabb(n);
    offsets.set(n.id, edge === "hcenter" ? { dx: b.x + b.w / 2 - (r.x + r.w / 2), dy: 0 } : { dx: 0, dy: b.y + b.h / 2 - (r.y + r.h / 2) });
  }
  applyOffsets("Align", offsets);
}

/** Lines the nodes up in a row or a column, in their current order. */
const distribute = (axis: "x" | "y") => applyOffsets("Distribute", lineUp(boxes(arrangeable()), axis, settings.arrangeGap));

/** Packs the selection into a compact block at its top-left corner, shaped to show well in the window. */
const tidy = () =>
  applyOffsets("Tidy up", pack(boxes(arrangeable()), settings.arrangeGap, { w: camera.width || 1600, h: camera.height || 900 }));

// ---------------------------------------------------------------- nudging

/**
 * Arrow keys move the selection. With snapping on, a step goes to the next grid line (the first
 * selected node lands on it, the rest keep their offsets), Shift goes five; Alt inverts the snap
 * setting, as it does for drags, so it moves 1 unit (10 with Shift). Presses are applied live and
 * a burst of them becomes one undo step once it settles, like counter clicks.
 */
const NUDGE_SETTLE_MS = 700;
let nudgeBurst: { from: Map<string, Record<string, unknown>>; timer: ReturnType<typeof setTimeout> } | null = null;

function flushNudge() {
  const burst = nudgeBurst;
  if (!burst) return;
  nudgeBurst = null;
  clearTimeout(burst.timer);
  const forward: NodeChange[] = [], backward: NodeChange[] = [];
  for (const [id, from] of burst.from) {
    const n = doc.nodes[id] as unknown as Record<string, unknown> | undefined;
    if (!n) continue;
    const now = Object.fromEntries(Object.keys(from).map((k) => [k, $state.snapshot(n[k])]));
    if (Object.keys(from).every((k) => JSON.stringify(now[k]) === JSON.stringify(from[k]))) continue;
    forward.push({ id, props: now as NodeChange["props"] });
    backward.push({ id, props: from as NodeChange["props"] });
  }
  if (forward.length) history.record("Nudge", [{ type: "updateNodes", changes: forward }], [{ type: "updateNodes", changes: backward }]);
}
history.addFlusher(flushNudge);

const canNudge = () => free().length > 0 && !mapUi.editing && !drawUi.active && !paletteUi.picking && !crop.id;

function nudge(ctx: ActionContext) {
  const key = ctx.key ?? "";
  const dir = /arrow(left|right|up|down)$/.exec(key)?.[1];
  const nodes = free();
  if (!dir || !nodes.length) return;
  const horizontal = dir === "left" || dir === "right";
  const sign = dir === "right" || dir === "down" ? 1 : -1;
  const far = key.includes("shift+");
  const grid = settings.snap !== key.includes("alt+");
  let d: number;
  if (grid) {
    // From the first node's position to the grid line `far ? 5 : 1` lines away in that direction.
    const g = settings.gridSize, at = horizontal ? nodes[0].x : nodes[0].y;
    const line = sign > 0 ? Math.floor(at / g + 1e-6) : Math.ceil(at / g - 1e-6);
    d = (line + sign * (far ? 5 : 1)) * g - at;
  } else {
    d = sign * (far ? 10 : 1);
  }
  const changes = carryChildren(
    carryMembers(nodes.map((n) => ({ id: n.id, props: horizontal ? { x: n.x + d } : { y: n.y + d } }))),
  );
  if (!nudgeBurst) nudgeBurst = { from: new Map(), timer: 0 as unknown as ReturnType<typeof setTimeout> };
  for (const c of changes) {
    const n = doc.nodes[c.id] as unknown as Record<string, unknown> | undefined;
    if (!n) continue;
    let from = nudgeBurst.from.get(c.id);
    if (!from) nudgeBurst.from.set(c.id, (from = {}));
    for (const k of Object.keys(c.props)) if (!(k in from)) from[k] = $state.snapshot(n[k]);
  }
  applyOp(doc, { type: "updateNodes", changes });
  clearTimeout(nudgeBurst.timer);
  nudgeBurst.timer = setTimeout(flushNudge, NUDGE_SETTLE_MS);
  play("tap", { volume: 0.35, throttle: 40, jitter: 0.1 });
}

const ARROWS = ["arrowleft", "arrowright", "arrowup", "arrowdown"];

/** The quick-add menu: every kind of node, at the pointer (or the middle of the view). */
function openQuickAdd() {
  exitDraw();
  const viewport = document.querySelector(".viewport")?.getBoundingClientRect();
  const p = ui.pointer ?? (viewport ? { x: viewport.left + camera.centerX, y: viewport.top + camera.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 });
  ui.menu = { x: p.x, y: p.y, world: placementPoint(), target: "add" };
}

/** Plays the selected video and audio, or pauses them all when any is playing. */
function togglePlaySelected() {
  const nodes = selectedNodes().filter(isPlayable);
  const sprites = selectedNodes().filter(isSprite);
  const timers = selectedNodes().filter(isTimer);
  const pause = nodes.some((n) => playing.has(n.id)) || sprites.some((n) => spriteUi.playing.has(n.id)) || timers.some((n) => isRunning(n.id));
  for (const n of nodes) {
    if (pause) playing.delete(n.id);
    else playing.add(n.id);
  }
  for (const n of sprites) if (spriteUi.playing.has(n.id) === pause) toggleSprite(n.id);
  for (const n of timers) if (isRunning(n.id) === pause) toggleTimer(n.id);
}
/** Video, audio, sprites and timers play. */
const playable = (n: CanvasNode) => isPlayable(n) || isSprite(n) || isTimer(n);

/** Turns looping on for these video/audio nodes, or off when all of them loop already. */
export function toggleLoop(nodes = selectedNodes().filter(isPlayable)) {
  if (!nodes.length) return;
  const on = !nodes.every(loops);
  const changes: NodeChange[] = nodes.map((n) => ({ id: n.id, props: { data: { ...mediaData(n), loop: on } } }));
  history.run(on ? "Loop on" : "Loop off", [{ type: "updateNodes", changes }]);
}

/**
 * Swaps the selected picture for another file, keeping its place, width, rotation and flips (the
 * height follows the new picture's shape): a template's placeholder becomes the real one.
 */
async function replacePicture() {
  const n = selectedNodes()[0];
  if (!n || (n.kind !== "image" && n.kind !== "gif")) return;
  const result = await backend.pickPicture("Replace picture");
  let asset = result?.assets[0];
  if (!asset) {
    if (result?.skipped.length) ui.notify("That file isn't a picture Patchwork can show", "warn");
    return;
  }
  if (asset.kind !== "image" && asset.kind !== "gif") return ui.notify("That file isn't a picture", "warn");
  // The board's "embed new files" applies, as it does to anything added.
  if (project.board.embedNew && asset.storage === "linked" && !doc.assets[asset.id]) {
    try {
      asset = (await backend.packAssets([asset]))[0];
    } catch (e) {
      ui.notify(`Couldn't embed: ${e}`, "warn");
    }
  }
  doc.assets[asset.id] ??= asset;
  const node = doc.nodes[n.id];
  if (!node) return;
  // A picture slot keeps its box; any other picture's height follows the new shape.
  const h = !slotOf(node) && asset.width && asset.height ? Math.round((node.w * asset.height) / asset.width) : node.h;
  history.run("Replace picture", [{ type: "updateNodes", changes: [{ id: node.id, props: { assetId: asset.id, kind: asset.kind, h } }] }]);
  markFresh([node.id]);
  play("appear", { volume: 0.5 });
}

/**
 * Picture slots: the box keeps its shape and the picture fits or fills it. Turning one off lets
 * the box follow the picture's own shape again (its width stays).
 */
function setSlot(mode: SlotMode | null) {
  crop.id = null;
  const nodes = selectedNodes().filter((n) => canSlot(n) && !n.locked);
  if (!nodes.length) return;
  const changes: NodeChange[] = nodes.map((n) => {
    const { slot: _s, focus: _f, ...rest } = mediaData(n);
    const asset = doc.assetOf(n);
    const props: NodeChange["props"] = { data: mode ? { ...rest, slot: mode, ...(mode === "fill" && mediaData(n).focus ? { focus: mediaData(n).focus } : {}) } : rest };
    if (!mode && asset?.width && asset.height) props.h = Math.round((n.w * asset.height) / asset.width);
    return { id: n.id, props };
  });
  history.run(mode === "fill" ? "Fill box" : mode === "fit" ? "Fit in box" : "Follow picture's shape", [{ type: "updateNodes", changes }]);
}

function nativeSize() {
  updateFree("Native size", (n) => {
    const asset = doc.assetOf(n);
    if (!asset) return null;
    const f = frameOf(n);
    return { w: asset.width, h: asset.height, x: f.cx - asset.width / 2, y: f.cy - asset.height / 2 };
  });
}

/** Selected pictures (images, GIFs, videos, PDFs) whose sizes can be matched; other selected nodes are left alone. */
const normalizable = () => free().filter(isPicture);
const canNormalize = () => normalizable().length > 1;

/**
 * Scales the selected pictures to their average height, width or area, about their centers,
 * keeping each one's proportions. A node turned more than 45° from upright shows its width as its
 * height, so that's what "height" means for it.
 */
function normalize(measure: "height" | "width" | "size") {
  const nodes = normalizable();
  if (nodes.length < 2) return;
  const sideways = (n: CanvasNode) => Math.abs((((n.rotation % 180) + 180) % 180) - 90) < 45;
  const value = (n: CanvasNode) =>
    measure === "size" ? n.w * n.h : (measure === "height") !== sideways(n) ? n.h : n.w;
  const target = nodes.reduce((sum, n) => sum + value(n), 0) / nodes.length;
  const label = { height: "Normalize height", width: "Normalize width", size: "Normalize size" }[measure];
  updateFree(label, (n) => {
    if (!isPicture(n)) return null;
    const k = measure === "size" ? Math.sqrt(target / value(n)) : target / value(n);
    if (Math.abs(k - 1) < 1e-6) return null;
    const f = frameOf(n), w = n.w * k, h = n.h * k;
    return { w, h, x: f.cx - w / 2, y: f.cy - h / 2 };
  });
}

function resetTransform() {
  updateFree("Reset transform", (n) => {
    const asset = doc.assetOf(n);
    const f = frameOf(n);
    const size = asset ? assetSize(asset) : { w: n.w, h: n.h };
    return {
      ...size,
      x: f.cx - size.w / 2,
      y: f.cy - size.h / 2,
      rotation: 0,
      data: { ...mediaData(n), flipX: false, flipY: false },
    };
  });
}

// ---------------------------------------------------------------- links

/** Copies of links between copied nodes, pointing at the copies (copy, paste, duplicate). */
export function remapLinks(links: CanvasLink[], ids: Map<string, string>): CanvasLink[] {
  return links
    .filter((l) => ids.has(l.from) && ids.has(l.to))
    .map((l) => ({ ...($state.snapshot(l) as CanvasLink), id: crypto.randomUUID(), from: ids.get(l.from)!, to: ids.get(l.to)! }));
}

/** Draws new links in rather than popping them. */
function markFreshLink(id: string) {
  fresh.set(id, 0);
  setTimeout(() => fresh.delete(id), 600);
}

/** New links for these pairs, skipping self-links, repeats and pairs already linked. */
function newLinks(pairs: [from: string, to: string][], extra: Partial<LinkData> = {}): CanvasLink[] {
  const seen = new Set<string>();
  const links: CanvasLink[] = [];
  for (const [from, to] of pairs) {
    if (from === to || !doc.nodes[from] || !doc.nodes[to]) continue;
    const key = [from, to].sort().join(" ");
    if (seen.has(key) || doc.linkBetween(from, to)) continue;
    seen.add(key);
    links.push({ id: crypto.randomUUID(), from, to, data: { ...newLinkData(), ...extra } });
  }
  return links;
}

/** Links these pairs as one undo step; pairs already linked are skipped. */
export function linkPairs(pairs: [from: string, to: string][], extra: Partial<LinkData> = {}): string[] {
  const links = newLinks(pairs, extra);
  if (!links.length) {
    if (pairs.some(([from, to]) => from !== to)) {
      play("denied", { volume: 0.4 });
      ui.notify("Already linked");
    }
    return [];
  }
  history.run(links.length > 1 ? `Add ${links.length} links` : "Link", [{ type: "addLinks", links }]);
  for (const l of links) markFreshLink(l.id);
  play("swipe", { pitch: 1.35, volume: 0.6 });
  return links.map((l) => l.id);
}

/** Links each of `froms` to `to`, the end at `to` pinned to `side` when given. */
export function createLinks(froms: string[], to: string, side: LinkSide | null = null): string[] {
  return linkPairs(froms.map((from) => [from, to]), side ? { toSide: side } : {});
}

/** A link handle dropped on empty canvas: a new text card there, linked from `froms`, being edited. */
export function createLinkedText(froms: string[], at: Point) {
  createText(at);
  const id = ui.editing?.id;
  if (!id) return;
  // Like the card itself, not recorded until the edit ends (see commitEdit).
  const links = newLinks(froms.map((from) => [from, id]));
  applyOp(doc, { type: "addLinks", links });
  for (const l of links) markFreshLink(l.id);
}

/**
 * Moves one end of a link onto `node`, pinned to `side` (null: the side facing the other end).
 * Dropping it back on the same node just changes the side.
 */
export function reconnectLink(id: string, end: "from" | "to", node: string, side: LinkSide | null) {
  const link = doc.links[id];
  if (!link || !doc.nodes[node]) return;
  const other = end === "from" ? link.to : link.from;
  if (node === other) return;
  const sideKey = end === "from" ? "fromSide" : "toSide";
  const data = linkData(link.data);
  if (link[end] === node && (data[sideKey] ?? null) === side) return;
  const clash = doc.linkBetween(node, other);
  if (clash && clash.id !== id) {
    play("denied", { volume: 0.4 });
    ui.notify("Already linked");
    return;
  }
  const label = link[end] === node ? "Pin link side" : "Reconnect link";
  history.run(label, [{ type: "updateLinks", changes: [{ id, props: { [end]: node, data: { ...data, [sideKey]: side } } }] }]);
  play("swipe", { pitch: 1.25, volume: 0.6 });
}

export function startLinkLabelEdit(id: string) {
  const link = doc.links[id];
  if (!link) return;
  selectLinks([id]);
  ui.editingLink = { id, original: linkData(link.data).label };
}

function commitLinkLabel() {
  const editing = ui.editingLink;
  if (!editing) return;
  ui.editingLink = null;
  const link = doc.links[editing.id];
  if (!link) return;
  const data = linkData(link.data);
  const label = data.label.trim();
  link.data = { ...data, label };
  if (label === editing.original) return;
  history.record(
    label ? "Label link" : "Remove link label",
    [{ type: "updateLinks", changes: [{ id: link.id, props: { data: { ...data, label } } }] }],
    [{ type: "updateLinks", changes: [{ id: link.id, props: { data: { ...data, label: editing.original } } }] }],
  );
}

/** Applies a per-link change to the selected links as one undoable step. */
function updateSelectedLinks(label: string, fn: (l: CanvasLink) => LinkChange["props"] | null) {
  const changes: LinkChange[] = [];
  for (const l of selectedLinks()) {
    const props = fn(l);
    if (props) changes.push({ id: l.id, props });
  }
  if (changes.length) history.run(label, [{ type: "updateLinks", changes }]);
}

const setArrow = (arrow: LinkArrow) => updateSelectedLinks("Arrows", (l) => ({ data: { ...linkData(l.data), arrow } }));
const setShape = (shape: LinkShape) => updateSelectedLinks("Link shape", (l) => ({ data: { ...linkData(l.data), shape } }));
const hasShape = (shape: LinkShape) => () => allLinks((l) => linkData(l.data).shape === shape);

export function setLinkColor(color: LinkColor) {
  play("button", { volume: 0.5 });
  updateSelectedLinks("Link color", (l) => ({ data: { ...linkData(l.data), color } }));
}

/** Swaps ends, so arrows point the other way. Pinned sides stay with their nodes. */
const reverseLinks = () =>
  updateSelectedLinks("Reverse link", (l) => {
    const d = linkData(l.data);
    return { from: l.to, to: l.from, data: { ...d, fromSide: d.toSide ?? null, toSide: d.fromSide ?? null } };
  });

const pinned = (l: CanvasLink) => !!(linkData(l.data).fromSide || linkData(l.data).toSide);

/** Lets both ends pick the side facing the other end again. */
const autoSides = () =>
  updateSelectedLinks("Automatic sides", (l) => (pinned(l) ? { data: { ...linkData(l.data), fromSide: null, toSide: null } } : null));

function toggleDashed() {
  const dashed = !allLinks((l) => linkData(l.data).dashed);
  updateSelectedLinks(dashed ? "Dashed link" : "Solid link", (l) => ({ data: { ...linkData(l.data), dashed } }));
}

/** The selected nodes in the order they were selected. */
const selectedIds = () => [...selection.values()].filter((id) => doc.nodes[id]);

/** Links the first selected node to each of the others (just the two, for two). */
function linkFromFirst() {
  const [hub, ...rest] = selectedIds();
  linkPairs(rest.map((id) => [hub, id]));
}

/** Links the selected nodes one after another, in the order they were selected. */
function linkInSequence() {
  const ids = selectedIds();
  linkPairs(ids.slice(1).map((id, i) => [ids[i], id]));
}

// ---------------------------------------------------------------- registry

export interface ActionContext {
  /** World point the action was invoked at (context menu). */
  at?: Point;
  /** The shortcut that ran it, e.g. "shift+3" (actions bound to several keys tell them apart). */
  key?: string;
}

export interface Action {
  id: string;
  label: string;
  icon?: Component;
  /** Shortcuts like "mod+shift+z"; the first one is displayed. */
  keys?: string[];
  /** Shown instead of the first key, for a range of keys ("1–9"). */
  keyLabel?: string;
  when?: () => boolean;
  active?: () => boolean;
  run: (ctx: ActionContext) => void;
  /** Played after the action runs. A function can pick by state (read before running). */
  sound?: Cue | (() => Cue);
  /** Buzz when its shortcut is pressed while unavailable (e.g. nothing to undo). */
  denied?: boolean;
  /** The webview handles the shortcut itself (paste needs the native event); `keys` is for display. */
  native?: boolean;
}

const click: Cue = ["button", { volume: 0.45 }];
const whoosh: Cue = ["swipe", { volume: 0.7 }];
/** Toggle sounds by the state the toggle is about to leave. */
const toggle = (on: () => boolean) => (): Cue => [on() ? "toggleOff" : "toggleOn", { volume: 0.6 }];

/** The number keys, matched by position (see `comboOf`). */
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
/** The number key that ran an action, if any. */
const digitOf = (ctx: ActionContext) => Number(/([0-9])$/.exec(ctx.key ?? "")?.[1]) || null;
/** The one selected pin's number. */
const selectedPinSlot = () => pinData(selectedNodes()[0].data).slot;

/** Opens a side panel tab, or closes the panel when it's showing that tab. In the clean view, it shows the chrome again. */
function togglePanel(tab: "outline" | "tasks" | "history") {
  if (ui.chromeHidden) {
    ui.chromeHidden = false;
    ui.panel = settings.panelTab = tab;
    return;
  }
  ui.panel = ui.panel === tab ? null : (settings.panelTab = tab);
}

/** Hides the chrome for a clean view of the board, or brings it back. */
function toggleChrome() {
  ui.chromeHidden = !ui.chromeHidden;
  if (!ui.chromeHidden) return;
  ui.settingsOpen = ui.shortcutsOpen = ui.pinsOpen = false;
  ui.notify(`${formatKeys("tab")} shows the interface again`);
}

function toggleSound() {
  // Play the "off" sound before muting, the "on" sound after unmuting.
  if (settings.sound) play("toggleOff", { volume: 0.6 });
  settings.sound = !settings.sound;
  if (settings.sound) play("toggleOn", { volume: 0.6 });
}

/** Zooms around the middle of the uncovered view, animated unless calm. */
function zoomStep(factor: number) {
  const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
  const w = camera.toWorld(camera.centerX, camera.height / 2);
  const to = { zoom: target, x: camera.centerX - w.x * target, y: camera.height / 2 - w.y * target };
  if (settings.calm) camera.set(to);
  else camera.animateTo(to, 200);
}

/**
 * The list of templates to stamp from, opened under the rail's button (or at the pointer); a
 * board without templates says how to make one.
 */
function openTemplates() {
  if (!templateList().length) return ui.notify("No templates yet: select a frame and choose Use as template");
  exitDraw();
  const button = document.querySelector('.rail [aria-label="New from template"]')?.getBoundingClientRect();
  const x = button ? button.right + 6 : (ui.pointer?.x ?? innerWidth / 2), y = button ? button.top : (ui.pointer?.y ?? innerHeight / 2);
  ui.menu = { x, y, world: camera.toWorld(camera.centerX, camera.height / 2), target: "templates" };
}

/** What Select contents selects: the unlocked members of the selected open frames (like Select all, locks stay out). */
function contentsOfFrames(): CanvasNode[] {
  return selectedNodes()
    .filter((n) => isFrameNode(n) && !frameData(n.data).collapsed)
    .flatMap(membersOf)
    .filter((n) => !n.locked);
}

const list: Action[] = [
  // general
  { id: "undo", label: "Undo", icon: Undo2, keys: ["mod+z"], when: () => history.canUndo, run: undo, sound: ["swipe", { pitch: 0.85, volume: 0.7 }], denied: true },
  { id: "redo", label: "Redo", icon: Redo2, keys: ["mod+shift+z", "mod+y"], when: () => history.canRedo, run: redo, sound: ["swipe", { pitch: 1.15, volume: 0.7 }], denied: true },
  { id: "new", label: "New board", icon: FilePlus2, keys: ["mod+n"], run: () => void newProject() },
  { id: "open", label: "Open…", icon: FolderOpen, keys: ["mod+o"], run: () => void open() },
  { id: "save", label: "Save", icon: Save, keys: ["mod+s"], run: () => void save() },
  { id: "saveAs", label: "Save as…", icon: SaveAll, keys: ["mod+shift+s"], run: () => void save(true) },
  { id: "openSettings", label: "Settings…", icon: Settings, keys: ["mod+,"], run: () => ((ui.settingsOpen = !ui.settingsOpen), (ui.shortcutsOpen = false)) },
  { id: "showOutline", label: "Outline", icon: ListTree, keys: ["mod+shift+o"], active: () => ui.panel === "outline", run: () => togglePanel("outline") },
  { id: "showTasks", label: "Tasks", icon: ListTodo, keys: ["mod+shift+k"], active: () => ui.panel === "tasks", run: () => togglePanel("tasks") },
  { id: "showHistory", label: "History", icon: HistoryIcon, keys: ["mod+shift+h"], active: () => ui.panel === "history", run: () => togglePanel("history") },
  { id: "find", label: "Find on the board", icon: SearchIcon, keys: ["mod+f"], run: () => (exitDraw(), openSearch()) },
  { id: "showShortcuts", label: "Keyboard shortcuts", icon: Keyboard, keys: ["?", "f1"], run: () => ((ui.shortcutsOpen = !ui.shortcutsOpen), (ui.settingsOpen = false)) },
  { id: "selectAll", label: "Select all", keys: ["mod+a"], run: () => selectOnly(doc.nodeList.filter((n) => !n.locked).map((n) => n.id)), sound: ["select", { volume: 0.5 }] },
  { id: "frame", label: "Zoom to fit", icon: Focus, keys: ["f"], when: () => doc.nodeList.length > 0, run: frameContent, sound: whoosh },
  { id: "addText", label: "Add text", icon: Type, keys: ["t"], when: () => !mapUi.editing, run: (ctx) => createText(placementPoint(ctx.at)) },
  { id: "frameSelection", label: "Frame selection", icon: Frame, keys: ["mod+g"], when: () => selectedNodes().some((n) => !isFrameNode(n)), run: frameSelection, sound: whoosh },
  { id: "addFrame", label: "Add frame", icon: SquareDashedTopSolid, keys: ["mod+g"], when: () => !any(), run: (ctx) => createFrame(placementPoint(ctx.at)), sound: whoosh },
  { id: "toggleFit", label: "Auto-fit", icon: Shrink, when: () => selectedNodes().some(isFrameNode), active: () => all((n) => isFrameNode(n) && !frameData(n.data).size), run: toggleFit },
  { id: "ungroup", label: "Ungroup", icon: Ungroup, keys: ["mod+shift+g"], when: () => selectedNodes().some(isFrameNode), run: ungroup, sound: whoosh },
  { id: "removeFromFrame", label: "Remove from frame", icon: LogOut, when: () => selectedNodes().some((n) => frames.owner.has(n.id)), run: removeFromFrame, sound: click },
  { id: "toggleTemplate", label: "Use as template", icon: LayoutTemplate, when: () => selectedNodes().some(isFrameNode), active: () => all(isTemplate), run: toggleTemplate },
  { id: "quickAdd", label: "Add…", icon: SquarePlus, keys: ["n"], when: () => !mapUi.editing, run: openQuickAdd },
  { id: "newFromTemplate", label: "New from template", icon: Stamp, when: () => !mapUi.editing, run: openTemplates },
  { id: "selectContents", label: "Select contents", icon: SquareDashedMousePointer, keys: ["mod+shift+a"], when: () => contentsOfFrames().length > 0, run: () => selectOnly(contentsOfFrames().map((n) => n.id)), sound: ["select", { volume: 0.5 }] },
  { id: "toggleCollapse", label: "Collapse", icon: FoldVertical, keys: ["shift+c"], when: () => selectedNodes().some(isFrameNode), active: () => all((n) => isFrameNode(n) && frameData(n.data).collapsed), run: toggleCollapse },
  { id: "editFrameTitle", label: "Rename frame", icon: Pencil, keys: ["enter", "f2"], when: () => single(isFrameNode), run: () => (frameUi.editing = selectedNodes()[0].id) },
  { id: "addTable", label: "Add table", icon: TableIcon, run: (ctx) => createTable(placementPoint(ctx.at)) },
  { id: "addCounter", label: "Add counter", icon: ListOrdered, run: (ctx) => createCounter(placementPoint(ctx.at)) },
  { id: "addTimer", label: "Add timer", icon: TimerIcon, run: (ctx) => createTimer(placementPoint(ctx.at)) },
  { id: "editTimer", label: "Set time…", icon: Pencil, keys: ["enter", "f2"], when: () => single(isTimer) && timerData(selectedNodes()[0].data).mode === "countdown" && !isRunning(selectedNodes()[0].id), run: () => (timerUi.editing = { nodeId: selectedNodes()[0].id, field: "duration" }) },
  { id: "renameTimer", label: "Rename timer", icon: Pencil, keys: ["enter", "f2"], when: () => single(isTimer), run: () => (timerUi.editing = { nodeId: selectedNodes()[0].id, field: "label" }) },
  { id: "resetTimer", label: "Reset timer", icon: RotateCcw, when: () => selectedNodes().some((n) => isTimer(n) && !!project.board.timers?.[n.id]), run: () => selectedNodes().filter(isTimer).forEach((n) => resetTimer(n.id)) },
  { id: "lapTimer", label: "Lap", icon: Flag, when: () => selectedNodes().some((n) => isTimer(n) && isRunning(n.id) && timerData(n.data).mode === "stopwatch"), run: () => selectedNodes().filter(isTimer).forEach((n) => lapTimer(n.id)) },
  // maps (their tool keys come before Draw's D, which is the door tool while a map is edited)
  { id: "addMap", label: "Add map", icon: Castle, run: (ctx) => (exitDraw(), stopPicking(), createMap(placementPoint(ctx.at))) },
  ...MAP_STYLES.map(
    (s): Action => ({
      id: `mapStyle-${s.id}`,
      label: s.label,
      icon: Castle,
      when: () => !!styledMap() && !styledMap()!.locked,
      active: () => !!styledMap() && mapData(styledMap()!.data).style === s.id,
      run: () => setMapStyle(s.id),
    }),
  ),
  { id: "editMap", label: "Edit map", icon: Pencil, keys: ["enter", "f2"], when: () => single(isMap) && !mapUi.editing, run: () => (exitDraw(), stopPicking(), enterMap(selectedNodes()[0].id)) },
  { id: "exitMap", label: "Done editing the map", keys: ["escape"], when: () => !!mapUi.editing, run: exitMap },
  { id: "mapRoom", label: "Room", icon: SquareDashed, keys: ["r"], when: () => !!mapUi.editing, active: () => mapUi.tool === "room", run: () => setMapTool("room") },
  { id: "mapBrush", label: "Brush", icon: Brush, keys: ["b"], when: () => !!mapUi.editing, active: () => mapUi.tool === "brush", run: () => setMapTool("brush") },
  { id: "mapErase", label: "Erase floor", icon: Eraser, keys: ["e"], when: () => !!mapUi.editing, active: () => mapUi.tool === "erase", run: () => setMapTool("erase") },
  { id: "mapWall", label: "Walls", icon: BrickWall, keys: ["w"], when: () => !!mapUi.editing, active: () => mapUi.tool === "wall", run: () => setMapTool("wall") },
  { id: "mapDiagonal", label: "Diagonal walls", icon: SquareSlash, keys: ["x"], when: () => !!mapUi.editing, active: () => mapUi.tool === "diagonal", run: () => setMapTool("diagonal") },
  { id: "mapDoor", label: "Doors", icon: DoorClosed, keys: ["d"], when: () => !!mapUi.editing, active: () => mapUi.tool === "door", run: () => setMapTool("door") },
  { id: "mapStamp", label: "Stamps", icon: StampIcon, keys: ["s"], when: () => !!mapUi.editing, active: () => mapUi.tool === "stamp", run: () => setMapTool("stamp") },
  { id: "mapPath", label: "Paths", icon: RouteIcon, keys: ["p"], when: () => !!mapUi.editing, active: () => mapUi.tool === "path", run: () => setMapTool("path") },
  { id: "mapExterior", label: "Exterior: terrain and roads", icon: TreesIcon, keys: ["o"], when: () => !!mapUi.editing, active: () => mapUi.tool === "exterior", run: () => setMapTool("exterior") },
  { id: "mapGrid", label: "Painting grid: full or half cells", keys: ["g"], when: () => !!mapUi.editing, active: () => settings.mapGrid === "half", run: toggleMapGrid },
  { id: "mapText", label: "Text labels", icon: Type, keys: ["t"], when: () => !!mapUi.editing, active: () => mapUi.tool === "text", run: () => setMapTool("text") },
  { id: "mapNumber", label: "Room numbers", icon: Hash, keys: ["n"], when: () => !!mapUi.editing, active: () => mapUi.tool === "number", run: () => setMapTool("number") },
  // drawing
  { id: "draw", label: "Draw", icon: PenLine, keys: ["d"], active: () => drawUi.active, run: () => (stopPicking(), exitMap(), toggleDraw(single(isDrawing) ? selectedNodes()[0].id : undefined)) },
  { id: "editDrawing", label: "Draw on it", icon: PenLine, keys: ["enter", "f2"], when: () => single(isDrawing), run: () => enterDraw(selectedNodes()[0].id) },
  { id: "exitDraw", label: "Done drawing", keys: ["escape"], when: () => drawUi.active, run: exitDraw },
  { id: "toolPen", label: "Pen", icon: Pen, keys: ["p"], when: () => drawUi.active, active: () => settings.inkTool === "pen", run: () => setTool("pen") },
  { id: "toolMarker", label: "Marker", icon: Highlighter, keys: ["h"], when: () => drawUi.active, active: () => settings.inkTool === "marker", run: () => setTool("marker") },
  { id: "toolEraser", label: "Eraser", icon: Eraser, keys: ["e"], when: () => drawUi.active, active: () => settings.inkTool === "eraser", run: () => setTool("eraser") },
  { id: "brushSmaller", label: "Smaller brush", keys: ["-"], when: () => drawUi.active, run: () => stepSize(-1) },
  { id: "brushLarger", label: "Larger brush", keys: ["="], when: () => drawUi.active, run: () => stepSize(1) },
  // palettes
  { id: "addPalette", label: "Add palette", icon: PaletteIcon, run: (ctx) => (exitDraw(), createPalette(placementPoint(ctx.at))) },
  { id: "pickColors", label: "Eyedropper", icon: Pipette, keys: ["i"], when: () => !!paletteUi.picking || single(isPalette), active: () => !!paletteUi.picking, run: () => (paletteUi.picking ? stopPicking() : (exitDraw(), exitMap(), startPicking(selectedNodes()[0].id))) },
  { id: "stopPicking", label: "Done picking colors", keys: ["escape"], when: () => !!paletteUi.picking, run: stopPicking },
  { id: "addSwatch", label: "Add color…", icon: Plus, when: () => single(isPalette), run: () => editColor(selectedNodes()[0].id, null) },
  { id: "sortHue", label: "Sort by hue", when: () => single((n) => isPalette(n) && paletteData(n.data).colors.length > 1), run: () => sortColors(selectedNodes()[0].id, "hue"), sound: click },
  { id: "sortLightness", label: "Sort by lightness", when: () => single((n) => isPalette(n) && paletteData(n.data).colors.length > 1), run: () => sortColors(selectedNodes()[0].id, "lightness"), sound: click },
  { id: "renamePalette", label: "Rename palette", icon: Pencil, keys: ["enter", "f2"], when: () => single(isPalette), run: () => (paletteUi.renaming = selectedNodes()[0].id) },
  { id: "extractPalette", label: "Extract palette", icon: SwatchBook, when: () => single((n) => isPicture(n) && !isSprite(n)), run: () => void extractPalette(selectedNodes()[0].id), sound: whoosh },
  { id: "addChecklist", label: "Add checklist", icon: ListChecks, keys: ["c"], run: (ctx) => createChecklist(placementPoint(ctx.at)) },
  // pins
  { id: "addPin", label: "Add pin", icon: MapPinPlus, run: (ctx) => createPin(placementPoint(ctx.at)) },
  { id: "jumpToPin", label: "Jump to pin, again to go back", icon: MapPin, keys: DIGITS, keyLabel: "1–9", run: (ctx) => { const n = digitOf(ctx); if (n) jumpToPin(n); } },
  { id: "nextPin", label: "Next pin", icon: ChevronsRight, keys: ["pagedown", "]"], when: () => pins.list.length > 0, run: () => stepPin(1) },
  { id: "prevPin", label: "Previous pin", icon: ChevronsLeft, keys: ["pageup", "["], when: () => pins.list.length > 0, run: () => stepPin(-1) },
  { id: "pinView", label: "Pin this view", icon: MapPinned, keys: DIGITS.map((d) => `shift+${d}`), keyLabel: `${formatKeys("shift+1")}–9`, run: (ctx) => { const n = digitOf(ctx) ?? freeSlot(); if (n) pinView(n); else ui.notify("All 9 pins are in use", "warn"); } },
  { id: "goToPin", label: "Jump to pin", icon: Navigation, when: () => single(isPin), run: () => jumpToPin(selectedPinSlot()) },
  { id: "editPinTitle", label: "Rename pin", icon: MapPinPen, keys: ["enter", "f2"], when: () => single(isPin), run: () => (pinUi.editing = selectedNodes()[0].id) },
  { id: "deselect", label: "Deselect", keys: ["escape"], when: () => any() || anyLinks(), run: clearSelection },

  // storage
  { id: "collectFiles", label: "Collect into folder…", icon: FolderInput, when: hasLinked, run: () => void collectFiles() },
  { id: "packBoard", label: "Pack into board file…", icon: Package, when: hasLinked, run: () => void packBoard() },
  { id: "unpackBoard", label: "Unpack to folder…", icon: PackageOpen, when: hasEmbedded, run: () => void unpackBoard() },
  { id: "relinkMissing", label: "Find missing files…", icon: FolderSync, when: hasMissing, run: () => void relinkMissing() },
  { id: "embedNew", label: "Embed new files", icon: FolderOutput, active: () => project.board.embedNew, run: toggleEmbedNew },

  // clipboard
  { id: "copy", label: "Copy", icon: ClipboardCopy, keys: ["mod+c"], when: any, run: () => copySelection() },
  { id: "cut", label: "Cut", icon: Scissors, keys: ["mod+x"], when: any, run: () => copySelection(true) },
  { id: "paste", label: "Paste", icon: ClipboardPaste, keys: ["mod+v"], native: true, run: (ctx) => void pasteFromMenu(ctx.at) },

  // any selection
  { id: "duplicate", label: "Duplicate", icon: Copy, keys: ["mod+d"], when: any, run: duplicate },
  { id: "front", label: "Bring to front", icon: BringToFront, keys: ["mod+]"], when: canRestack, run: () => restack(true), sound: ["button", { volume: 0.45, pitch: 1.1 }] },
  { id: "back", label: "Send to back", icon: SendToBack, keys: ["mod+["], when: canRestack, run: () => restack(false), sound: ["button", { volume: 0.45, pitch: 0.9 }] },
  { id: "rotate90", label: "Rotate 90°", icon: RotateCw, keys: ["r"], when: () => free().some((n) => !isFrameNode(n) && !isPin(n)), run: () => updateFree("Rotate", (n) => (isFrameNode(n) || isPin(n) ? null : { rotation: normalizeDeg(n.rotation + 90) })), sound: whoosh },
  { id: "attachToParent", label: "Attach to last selected", icon: Plug, keys: ["mod+p"], when: canAttach, run: attachToParent },
  { id: "detachFromParent", label: "Detach from parent", icon: Unplug, keys: ["mod+shift+p"], when: canDetach, run: detachFromParent },
  { id: "exportNode", label: "Export…", icon: ImageDown, keys: ["mod+e"], when: () => selectedNodes().some(isExportable), run: () => openExport(selectedNodes().filter(isExportable).map((n) => n.id)) },
  { id: "lock", label: "Lock", icon: LockIcon, keys: ["mod+shift+l"], when: () => selectedNodes().some((n) => !n.locked), run: () => setLocked(true), sound: click },
  { id: "unlock", label: "Unlock", icon: LockOpen, keys: ["mod+shift+l"], when: () => all((n) => !!n.locked), run: () => setLocked(false), sound: click },
  { id: "delete", label: "Delete", icon: Trash2, keys: ["delete", "backspace", "x"], when: () => any() || anyLinks(), run: () => deleteSelection() },

  // media
  { id: "togglePlay", label: "Play / pause", icon: PlayIcon, keys: ["k"], when: () => all(playable), active: () => selectedNodes().some((n) => playing.has(n.id) || spriteUi.playing.has(n.id) || isRunning(n.id)), run: togglePlaySelected },
  { id: "prevFrame", label: "Previous frame", icon: ChevronLeft, keys: ["arrowleft", ","], when: () => single(isSprite), run: () => stepSprite(selectedNodes()[0].id, -1) },
  { id: "nextFrame", label: "Next frame", icon: ChevronRight, keys: ["arrowright", "."], when: () => single(isSprite), run: () => stepSprite(selectedNodes()[0].id, 1) },
  { id: "toggleLoop", label: "Loop", icon: Repeat, keys: ["shift+k"], when: () => all(isPlayable), active: () => all(loops), sound: toggle(() => all(loops)), run: () => toggleLoop() },
  { id: "slotFit", label: "Fit in box", icon: Minimize2, when: () => single((n) => canSlot(n) && !n.locked), active: () => single((n) => slotOf(n) === "fit"), run: () => setSlot("fit") },
  { id: "slotFill", label: "Fill box", icon: Maximize2, when: () => single((n) => canSlot(n) && !n.locked), active: () => single((n) => slotOf(n) === "fill"), run: () => setSlot("fill") },
  { id: "cropPicture", label: "Reposition picture", icon: Move, when: () => single((n) => slotOf(n) === "fill" && !n.locked), active: () => crop.id !== null, run: () => (crop.id = crop.id ? null : selectedNodes()[0]?.id ?? null) },
  { id: "slotOff", label: "Follow picture's shape", icon: ImageIcon, when: () => single((n) => !!slotOf(n) && !n.locked), run: () => setSlot(null) },
  { id: "flipH", label: "Flip horizontal", icon: FlipHorizontal2, keys: ["shift+h"], when: () => allFree(isVisual), active: () => allFree((n) => !!mediaData(n).flipX), sound: toggle(() => allFree((n) => !!mediaData(n).flipX)), run: () => updateFree("Flip", (n) => ({ data: { ...mediaData(n), flipX: !mediaData(n).flipX } })) },
  { id: "flipV", label: "Flip vertical", icon: FlipVertical2, keys: ["shift+v"], when: () => allFree(isVisual), active: () => allFree((n) => !!mediaData(n).flipY), sound: toggle(() => allFree((n) => !!mediaData(n).flipY)), run: () => updateFree("Flip", (n) => ({ data: { ...mediaData(n), flipY: !mediaData(n).flipY } })) },
  { id: "normalizeHeight", label: "Normalize height", icon: UnfoldVertical, keys: ["mod+alt+arrowup", "mod+alt+arrowdown"], when: canNormalize, run: () => normalize("height"), sound: whoosh },
  { id: "normalizeWidth", label: "Normalize width", icon: UnfoldHorizontal, keys: ["mod+alt+arrowleft", "mod+alt+arrowright"], when: canNormalize, run: () => normalize("width"), sound: whoosh },
  { id: "normalizeSize", label: "Normalize size", icon: Proportions, keys: ["mod+alt+0"], when: canNormalize, run: () => normalize("size"), sound: whoosh },
  { id: "nativeSize", label: "Native size", icon: Maximize, keys: ["mod+0"], when: () => allFree(isPicture), run: nativeSize, sound: whoosh },
  { id: "resetTransform", label: "Reset transform", icon: RotateCcw, when: () => allFree(hasFile), run: resetTransform, sound: whoosh },
  { id: "prevPage", label: "Previous page", icon: ChevronLeft, keys: ["arrowleft"], when: turnable, run: () => selectedNodes().forEach((n) => stepPage(n.id, -1)) },
  { id: "nextPage", label: "Next page", icon: ChevronRight, keys: ["arrowright"], when: turnable, run: () => selectedNodes().forEach((n) => stepPage(n.id, 1)) },
  { id: "firstPage", label: "First page", icon: ChevronFirst, keys: ["home"], when: turnable, run: () => selectedNodes().forEach((n) => goToPage(n.id, 0)) },
  { id: "lastPage", label: "Last page", icon: ChevronLast, keys: ["end"], when: turnable, run: () => selectedNodes().forEach((n) => goToPage(n.id, (pagesOf(n) ?? 1) - 1)) },
  { id: "spreadPages", label: "Spread out pages", icon: BookOpen, when: () => single(isPdf) && (pagesOf(selectedNodes()[0]) ?? 0) > 1, run: () => void spreadPages(selectedNodes()[0].id), sound: whoosh },
  { id: "replacePicture", label: "Replace picture…", icon: ImageUp, when: () => backend.kind === "tauri" && single((n) => (n.kind === "image" || n.kind === "gif") && !n.locked), run: () => void replacePicture() },
  { id: "reveal", label: isMac ? "Reveal in Finder" : isWindows ? "Show in Explorer" : "Show in file manager", icon: FolderSearch, when: () => single((n) => hasFile(n) && doc.assetOf(n)?.storage === "linked"), run: () => { const a = doc.assetOf(selectedNodes()[0]); if (a) backend.revealFile(a.path); } },

  // text
  { id: "editText", label: "Edit text", icon: Pencil, keys: ["enter", "f2"], when: () => single(isText), run: () => startEdit([...selection.values()][0]) },
  { id: "countUp", label: "Count up", icon: CirclePlus, keys: ["arrowup", "="], when: () => !!theCounter(), run: () => void count(theCounter()!.id, 1) },
  { id: "countUp10", label: "Count up by 10 steps", keys: ["shift+arrowup"], when: () => !!theCounter(), run: () => void count(theCounter()!.id, 10) },
  { id: "countDown", label: "Count down", icon: CircleMinus, keys: ["arrowdown", "-"], when: () => !!theCounter(), run: () => void count(theCounter()!.id, -1) },
  { id: "countDown10", label: "Count down by 10 steps", keys: ["shift+arrowdown"], when: () => !!theCounter(), run: () => void count(theCounter()!.id, -10) },
  { id: "setGoal", label: "Set goal…", icon: Goal, when: () => !!theCounter(), run: () => (counterUi.editing = { nodeId: theCounter()!.id, field: "goal" }) },
  { id: "removeGoal", label: "Remove goal", icon: CircleOff, when: () => !!theCounter() && !!counterData(theCounter()!.data).goal, run: () => setCounter(theCounter()!.id, "Remove goal", { goal: null }), sound: click },
  { id: "counterStep", label: "Step size…", icon: Footprints, when: () => !!theCounter(), run: () => (counterUi.editing = { nodeId: theCounter()!.id, field: "step" }) },
  { id: "counterReset", label: "Reset to 0", icon: RotateCcwSquare, when: () => !!theCounter() && counterData(theCounter()!.data).value > 0, run: () => setCounter(theCounter()!.id, "Reset counter", { value: 0 }), sound: whoosh },
  { id: "editChecklist", label: "Edit checklist", icon: Pencil, keys: ["enter", "f2"], when: () => single(isChecklist), run: () => startEdit([...selection.values()][0]) },
  { id: "hideDone", label: "Hide completed", icon: ListMinus, keys: ["h"], when: () => all(isChecklist), active: () => all((n) => !!checklistData(n.data).hideDone), sound: toggle(() => all((n) => !!checklistData(n.data).hideDone)), run: () => { const on = !all((n) => !!checklistData(n.data).hideDone); updateSelected(on ? "Hide completed" : "Show completed", (n) => (isChecklist(n) ? { data: { ...checklistData(n.data), hideDone: on } } : null)); } },
  { id: "fontDown", label: "Smaller text", icon: AArrowDown, keys: ["mod+-"], when: () => allFree(isFlow), run: () => scaleFont(1 / 1.25), sound: ["button", { volume: 0.45, pitch: 0.9 }] },
  { id: "resetTextSize", label: "Default text size", icon: ALargeSmall, when: () => allFree(isFlow) && free().some((n) => fontSizeOf(n) !== defaultFont(n)), run: resetFont, sound: click },
  { id: "fixedHeight", label: "Fixed height", icon: ArrowUpDown, when: () => !ui.editing && free().some(isText), active: () => free().filter(isText).every((n) => textData(n.data).fixed), sound: toggle(() => free().filter(isText).every((n) => textData(n.data).fixed)), run: toggleFixedHeight },
  { id: "fitTextWidth", label: "Fit width to text", icon: FoldHorizontal, when: () => !ui.editing && free().some(isText), run: fitTextWidth, sound: click },
  { id: "fontUp", label: "Larger text", icon: AArrowUp, keys: ["mod+="], when: () => allFree(isFlow), run: () => scaleFont(1.25), sound: ["button", { volume: 0.45, pitch: 1.1 }] },
  { id: "alignTextLeft", label: "Align text left", icon: TextAlignStart, when: () => all(isText), active: () => all((n) => textData(n.data).align === "left"), run: () => setTextAlign("left"), sound: click },
  { id: "alignTextCenter", label: "Center text", icon: TextAlignCenter, when: () => all(isText), active: () => all((n) => textData(n.data).align === "center"), run: () => setTextAlign("center"), sound: click },
  { id: "alignTextRight", label: "Align text right", icon: TextAlignEnd, when: () => all(isText), active: () => all((n) => textData(n.data).align === "right"), run: () => setTextAlign("right"), sound: click },

  // formatting the text card being edited (the rich editor handles these keys itself; they're here for
  // the toolbar, the shortcuts panel and their tooltips)
  { id: "formatBold", label: "Bold", icon: BoldIcon, keys: ["mod+b"], when: formatting, active: () => isActive("bold"), run: () => format((c) => c.toggleBold()) },
  { id: "formatItalic", label: "Italic", icon: ItalicIcon, keys: ["mod+i"], when: formatting, active: () => isActive("italic"), run: () => format((c) => c.toggleItalic()) },
  { id: "formatStrike", label: "Strikethrough", icon: StrikeIcon, keys: ["mod+shift+s"], when: formatting, active: () => isActive("strike"), run: () => format((c) => c.toggleStrike()) },
  { id: "formatCode", label: "Code", icon: CodeIcon, keys: ["mod+e"], when: formatting, active: () => isActive("code"), run: () => format((c) => c.toggleCode()) },
  { id: "formatLink", label: "Link", icon: LinkIcon, keys: ["mod+k"], when: formatting, active: () => isActive("link"), run: openLinkBar },
  { id: "formatParagraph", label: "Normal text", icon: Pilcrow, keys: ["mod+alt+0"], when: formatting, active: () => isActive("paragraph"), run: () => format((c) => c.setParagraph()) },
  { id: "formatH1", label: "Heading 1", icon: Heading1, keys: ["mod+alt+1"], when: formatting, active: () => isActive("heading", { level: 1 }), run: () => toggleHeading(1) },
  { id: "formatH2", label: "Heading 2", icon: Heading2, keys: ["mod+alt+2"], when: formatting, active: () => isActive("heading", { level: 2 }), run: () => toggleHeading(2) },
  { id: "formatH3", label: "Heading 3", icon: Heading3, keys: ["mod+alt+3"], when: formatting, active: () => isActive("heading", { level: 3 }), run: () => toggleHeading(3) },
  { id: "formatBullets", label: "Bulleted list", icon: ListIcon, keys: ["mod+shift+8"], when: formatting, active: () => isActive("bulletList"), run: () => format((c) => c.toggleBulletList()) },
  { id: "formatNumbers", label: "Numbered list", icon: ListOrdered, keys: ["mod+shift+7"], when: formatting, active: () => isActive("orderedList"), run: () => format((c) => c.toggleOrderedList()) },
  { id: "formatTasks", label: "Task list", icon: ListTodo, keys: ["mod+shift+9"], when: formatting, active: () => isActive("taskList"), run: () => format((c) => c.toggleTaskList()) },
  { id: "formatQuote", label: "Quote", icon: TextQuote, keys: ["mod+shift+b"], when: formatting, active: () => isActive("blockquote"), run: () => format((c) => c.toggleBlockquote()) },
  { id: "formatClear", label: "Clear formatting", icon: RemoveFormatting, when: formatting, run: () => format((c) => c.unsetAllMarks().clearNodes()) },

  // multiple
  { id: "alignLeft", label: "Align left", icon: AlignStartVertical, keys: ["mod+arrowleft"], when: canArrange, run: () => align("left"), sound: whoosh },
  { id: "alignHCenter", label: "Align centers", icon: AlignCenterVertical, keys: ["alt+h"], when: canArrange, run: () => align("hcenter"), sound: whoosh },
  { id: "alignRight", label: "Align right", icon: AlignEndVertical, keys: ["mod+arrowright"], when: canArrange, run: () => align("right"), sound: whoosh },
  { id: "alignTop", label: "Align top", icon: AlignStartHorizontal, keys: ["mod+arrowup"], when: canArrange, run: () => align("top"), sound: whoosh },
  { id: "alignVCenter", label: "Align middles", icon: AlignCenterHorizontal, keys: ["alt+v"], when: canArrange, run: () => align("vcenter"), sound: whoosh },
  { id: "alignBottom", label: "Align bottom", icon: AlignEndHorizontal, keys: ["mod+arrowdown"], when: canArrange, run: () => align("bottom"), sound: whoosh },
  { id: "distributeH", label: "Distribute horizontally", icon: AlignHorizontalSpaceAround, keys: ["mod+shift+arrowright", "mod+shift+arrowleft"], when: canArrange, run: () => distribute("x"), sound: whoosh },
  { id: "distributeV", label: "Distribute vertically", icon: AlignVerticalSpaceAround, keys: ["mod+shift+arrowdown", "mod+shift+arrowup"], when: canArrange, run: () => distribute("y"), sound: whoosh },
  { id: "tidy", label: "Tidy up", icon: LayoutGrid, keys: ["shift+t"], when: canArrange, run: tidy, sound: whoosh },


  // links
  { id: "linkNodes", label: "Link nodes", icon: Spline, keys: ["l"], when: () => selectedIds().length === 2, run: linkFromFirst },
  { id: "linkFromFirst", label: "Link first to the rest", icon: Network, keys: ["l"], when: () => selectedIds().length > 2, run: linkFromFirst },
  { id: "linkInSequence", label: "Link in sequence", icon: Waypoints, keys: ["shift+l"], when: () => selectedIds().length > 2, run: linkInSequence },
  { id: "autoSides", label: "Automatic sides", icon: Magnet, when: () => selectedLinks().some(pinned), run: autoSides, sound: whoosh },
  { id: "editLinkLabel", label: "Edit label", icon: Tag, keys: ["enter", "f2"], when: singleLink, run: () => startLinkLabelEdit([...linkSelection.values()][0]) },
  { id: "arrowNone", label: "No arrows", icon: Minus, when: anyLinks, active: () => allLinks((l) => linkData(l.data).arrow === "none"), run: () => setArrow("none"), sound: click },
  { id: "arrowEnd", label: "Arrow at end", icon: MoveRight, when: anyLinks, active: () => allLinks((l) => linkData(l.data).arrow === "end"), run: () => setArrow("end"), sound: click },
  { id: "arrowBoth", label: "Arrows at both ends", icon: MoveHorizontal, when: anyLinks, active: () => allLinks((l) => linkData(l.data).arrow === "both"), run: () => setArrow("both"), sound: click },
  { id: "shapeCurve", label: "Curved", icon: ShapeCurve, when: anyLinks, active: hasShape("curve"), run: () => setShape("curve"), sound: click },
  { id: "shapeStraight", label: "Straight", icon: ShapeStraight, when: anyLinks, active: hasShape("straight"), run: () => setShape("straight"), sound: click },
  { id: "shapeElbow", label: "Elbow", icon: ShapeElbow, when: anyLinks, active: hasShape("elbow"), run: () => setShape("elbow"), sound: click },
  { id: "reverseLink", label: "Reverse direction", icon: ArrowRightLeft, keys: ["shift+r"], when: anyLinks, run: reverseLinks, sound: whoosh },
  { id: "dashedLink", label: "Dashed", icon: Ellipsis, when: anyLinks, active: () => allLinks((l) => linkData(l.data).dashed), sound: toggle(() => allLinks((l) => linkData(l.data).dashed)), run: toggleDashed },

  // preferences
  { id: "toggleSound", label: "Sound effects", icon: Volume2, keys: ["mod+shift+m"], active: () => settings.sound, run: toggleSound },
  { id: "togglePerf", label: "Performance overlay", icon: Gauge, keys: ["f3"], active: () => settings.perf, run: () => (settings.perf = !settings.perf) },
  { id: "toggleMinimap", label: "Minimap", icon: MapIcon, keys: ["m"], active: () => settings.minimap, sound: toggle(() => settings.minimap), run: () => (settings.minimap = !settings.minimap) },
  { id: "toggleChrome", label: "Clean view", icon: EyeOff, keys: ["tab"], active: () => ui.chromeHidden, sound: toggle(() => ui.chromeHidden), run: toggleChrome },
  { id: "toggleCalm", label: "Calm mode", icon: Leaf, keys: ["mod+shift+c"], active: () => settings.calm, sound: toggle(() => settings.calm), run: () => (settings.calm = !settings.calm) },

  // Last, so the same keys on a selection come first: ⌘+/− size text cards, ⌘0 sizes pictures.
  { id: "zoomIn", label: "Zoom in", icon: ZoomIn, keys: ["mod+="], run: () => zoomStep(1.25) },
  { id: "zoomOut", label: "Zoom out", icon: ZoomOut, keys: ["mod+-"], run: () => zoomStep(1 / 1.25) },
  { id: "resetZoom", label: "Reset zoom to 100%", keys: ["shift+0", "mod+0"], run: () => zoomStep(1 / camera.zoom) },
  // Plain arrows go to counters, sprites, PDFs and table cells first.
  { id: "nudge", label: "Nudge", keys: ARROWS, keyLabel: "←↑→↓", when: canNudge, run: nudge },
  { id: "nudgeFar", label: "Nudge further", keys: ARROWS.map((k) => `shift+${k}`), keyLabel: `${formatKeys("shift")} ←↑→↓`, when: canNudge, run: nudge },
  { id: "nudgeFree", label: "Nudge without the grid", keys: ARROWS.map((k) => `alt+${k}`), keyLabel: `${formatKeys("alt")} ←↑→↓`, when: canNudge, run: nudge },
];

export const actions: Record<string, Action> = Object.fromEntries(list.map((a) => [a.id, a]));

export function available(id: string): boolean {
  const a = actions[id];
  return !!a && (a.when?.() ?? true);
}

/** Runs an action and plays its sound. */
function perform(action: Action, ctx: ActionContext) {
  const cue = typeof action.sound === "function" ? action.sound() : action.sound;
  action.run(ctx);
  playCue(cue);
}

export function runAction(id: string, ctx: ActionContext = {}) {
  if (available(id)) perform(actions[id], ctx);
}

// ---------------------------------------------------------------- keyboard

function comboOf(e: KeyboardEvent): string {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  let key = e.key.toLowerCase();
  if (key === "+") key = "="; // same physical key on most layouts
  // Number keys by position: with Shift they type symbols ("!" for 1), and some layouts type
  // symbols without it.
  const digit = /^Digit([0-9])$/.exec(e.code);
  if (digit) key = digit[1];
  // Option+letter types a symbol on macOS ("˙" for H) or starts a dead key: take the letter.
  if (e.altKey && !/^[a-z]$/.test(key)) {
    const letter = /^Key([A-Z])$/.exec(e.code);
    if (letter) key = letter[1].toLowerCase();
  }
  // "?" needs Shift on some layouts and not on others: bind it by the character alone.
  if (key === "?" && !mod && !e.altKey) return "?";
  return [mod && "mod", e.shiftKey && "shift", e.altKey && "alt", key].filter(Boolean).join("+");
}

/** Runs the action bound to this key press. Returns true if one ran. */
export function handleShortcut(e: KeyboardEvent): boolean {
  const combo = comboOf(e);
  const bound = list.filter((a) => !a.native && a.keys?.includes(combo));
  const action = bound.find((a) => a.when?.() ?? true);
  if (!action) {
    if (bound.some((a) => a.denied)) {
      e.preventDefault();
      play("denied", { volume: 0.5 });
    }
    return false;
  }
  e.preventDefault();
  perform(action, { key: combo });
  return true;
}

/** A tooltip for an action: its label and shortcut. */
export const actionTip = (id: string): TipContent => ({ text: actions[id].label, keys: shortcutOf(actions[id]) });

/** How an action's shortcut is shown: its key label, or its first key. */
export function shortcutOf(a: Action): string | null {
  return a.keyLabel ?? (a.keys ? formatKeys(a.keys[0]) : null);
}

/** "mod+shift+z" → "⇧⌘Z" on macOS, "Ctrl+Shift+Z" elsewhere. */
export function formatKeys(keys: string): string {
  const names: Record<string, [mac: string, other: string]> = {
    mod: ["⌘", "Ctrl"],
    shift: ["⇧", "Shift"],
    alt: ["⌥", "Alt"],
    delete: ["⌦", "Del"],
    backspace: ["⌫", "Backspace"],
    escape: ["Esc", "Esc"],
    tab: ["⇥", "Tab"],
    enter: ["↩", "Enter"],
    "=": ["+", "+"],
    pagedown: ["PgDn", "PgDn"],
    pageup: ["PgUp", "PgUp"],
    arrowup: ["↑", "↑"],
    arrowdown: ["↓", "↓"],
    arrowleft: ["←", "←"],
    arrowright: ["→", "→"],
    home: ["Home", "Home"],
    end: ["End", "End"],
  };
  const parts = keys.split("+").map((p) => (names[p] ? names[p][isMac ? 0 : 1] : p.toUpperCase()));
  if (isMac) {
    // macOS convention orders modifiers ⌃⌥⇧⌘ and joins without separators.
    const order = ["⌥", "⇧", "⌘"];
    parts.sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9));
    return parts.join("");
  }
  return parts.join("+");
}
