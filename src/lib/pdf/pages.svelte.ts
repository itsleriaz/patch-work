import { doc, history, markFresh, selectOnly, ui } from "../app.svelte";
import type { Op } from "../doc/ops.svelte";
import type { CanvasNode } from "../doc/types";
import { nearestFree } from "../canvas/layout";
import { aabb } from "../doc/geometry";
import { frames, membersOf, reassign, shown } from "../frame/frames.svelte";
import { DEFAULT_FRAME, fitRect, isFrame } from "../frame/model";
import { play } from "../juice/sound";
import { flyToNode } from "../outline/outline.svelte";
import { parents } from "../parent/parents.svelte";
import { docTitle, pdfData, type PdfData } from "./model";
import { pageSizes, pdfPages } from "./pdf.svelte";

/**
 * Turning a PDF node's pages. Flips show at once; a burst of them becomes one undo step
 * ("Page 3 → 8") once it settles, as counting does. History flushes a pending burst first.
 */
const SETTLE_MS = 900;

const bursts = new Map<string, { from: PdfData; timer: ReturnType<typeof setTimeout> }>();

function flush(id: string) {
  const burst = bursts.get(id);
  if (!burst) return;
  bursts.delete(id);
  clearTimeout(burst.timer);
  const node = doc.nodes[id];
  if (!node) return;
  const now = pdfData($state.snapshot(node.data));
  if (now.page === burst.from.page) return;
  const change = (data: PdfData): Op[] => [{ type: "updateNodes", changes: [{ id, props: { data } }] }];
  history.record(`Page ${burst.from.page + 1} → ${now.page + 1}`, change(now), change(burst.from));
}

export function flushAllFlips() {
  for (const id of [...bursts.keys()]) flush(id);
}
history.addFlusher(flushAllFlips);

/** A PDF node's page count, once its document is open. */
export function pagesOf(node: CanvasNode): number | undefined {
  const asset = doc.assetOf(node);
  return asset ? pdfPages.get(asset.hash) : undefined;
}

/** The page a PDF node shows, within its document. */
export function pageOf(node: CanvasNode): number {
  const page = pdfData(node.data).page;
  const pages = pagesOf(node);
  return pages ? Math.min(page, pages - 1) : page;
}

/** Shows page `to` (from 0, clamped). Returns false when it's already there. */
export function goToPage(id: string, to: number): boolean {
  const node = doc.nodes[id];
  const pages = node && node.kind === "pdf" ? pagesOf(node) : undefined;
  if (!node || !pages) return false;
  const d = pdfData($state.snapshot(node.data));
  const page = Math.max(0, Math.min(pages - 1, to));
  if (page === Math.min(d.page, pages - 1)) {
    play("denied", { volume: 0.4, throttle: 120 });
    return false;
  }
  let burst = bursts.get(id);
  if (!burst) {
    burst = { from: d, timer: 0 as unknown as ReturnType<typeof setTimeout> };
    bursts.set(id, burst);
  }
  clearTimeout(burst.timer);
  burst.timer = setTimeout(() => flush(id), SETTLE_MS);
  node.data = { ...d, page };
  play("tap", { volume: 0.45, throttle: 30, pitch: page > d.page ? 1.08 : 0.92 });
  return true;
}

export const stepPage = (id: string, delta: number) => goToPage(id, pageOf(doc.nodes[id]) + delta);

/** Columns for `n` pages of a cell size: the block comes out about 16:10. */
function columnsFor(n: number, cell: { w: number; h: number }) {
  return Math.max(1, Math.min(n, Math.ceil(Math.sqrt((n * 1.6 * cell.h) / cell.w))));
}

const GAP = 20;

/**
 * Lays a PDF node's pages out as nodes of their own, in reading order, in a new frame titled after
 * the document. The node itself becomes page 1 (keeping its links), at its scale. The spread
 * starts at the node's corner, or the nearest spot where it covers nothing else.
 */
export async function spreadPages(id: string) {
  const node = doc.nodes[id];
  const asset = node && doc.assetOf(node);
  if (!node || !asset) return;
  let sizes: { w: number; h: number }[];
  try {
    sizes = await pageSizes(asset);
  } catch {
    return ui.notify("Couldn't read this PDF's pages", "warn");
  }
  const current = doc.nodes[id];
  if (sizes.length < 2 || !current) return;

  // The scale the node shows its page at, so the pages come out the size it looked.
  const shownSize = sizes[pageOf(current)];
  const k = Math.min(current.w / shownSize.w, current.h / shownSize.h);
  const scaled = sizes.map((s) => ({ w: Math.round(s.w * k), h: Math.round(s.h * k) }));
  const cell = { w: Math.max(...scaled.map((s) => s.w)), h: Math.max(...scaled.map((s) => s.h)) };
  const cols = columnsFor(scaled.length, cell);

  let z = doc.maxZ();
  const data = pdfData($state.snapshot(current.data));
  const pages: CanvasNode[] = scaled.map((s, i) => ({
    id: i === 0 ? current.id : crypto.randomUUID(),
    kind: "pdf",
    assetId: asset.id,
    x: current.x + (i % cols) * (cell.w + GAP),
    y: current.y + Math.floor(i / cols) * (cell.h + GAP),
    w: s.w,
    h: s.h,
    rotation: 0,
    z: i === 0 ? current.z : ++z,
    data: { ...data, page: i },
  }));

  // Everything else on the board, except a frame that only holds this node (it goes away).
  const obstacles = doc.nodeList
    .filter((n) => n.id !== current.id && !frames.hidden.has(n.id))
    .filter((n) => !isFrame(n) || membersOf(n).some((m) => m.id !== current.id))
    .map((n) => aabb(shown(n)));
  const box = fitRect(pages)!;
  const free = nearestFree(box, obstacles);
  for (const p of pages) {
    p.x += free.x - box.x;
    p.y += free.y - box.y;
  }

  const [first, ...rest] = pages;
  const frame: CanvasNode = {
    id: crypto.randomUUID(),
    kind: "frame",
    assetId: null,
    ...box,
    x: free.x,
    y: free.y,
    rotation: 0,
    z: 0,
    data: { ...DEFAULT_FRAME, title: docTitle(asset.name), members: pages.map((p) => p.id) },
  };
  history.run(`Spread out ${pages.length} pages`, [
    // Out of any frame it was in: frames don't nest.
    ...reassign(new Map([[current.id, null]])),
    // It leaves its family: it moves into a frame of its own, away from its parent and children.
    { type: "updateNodes", changes: [
      { id: first.id, props: { x: first.x, y: first.y, w: first.w, h: first.h, rotation: 0, data: first.data, parent: undefined } },
      ...(parents.children.get(first.id) ?? []).map((id) => ({ id, props: { parent: undefined } })),
    ] },
    { type: "addNodes", nodes: [...rest, frame] },
  ]);
  selectOnly([frame.id]);
  markFresh(rest.map((p) => p.id));
  // Step back to show the whole spread (flying never zooms in).
  flyToNode(frame.id);
}
