import { remapLinks } from "./actions.svelte";
import { deleteSelection, doc, history, markFresh, placeAssets, placementPoint, selectedNodes, selectOnly, ui } from "./app.svelte";
import { hexCodesIn, paletteData } from "./palette/model";
import { addColors, isPalette, placePalette } from "./palette/palette.svelte";
import { backend } from "./backend";
import { snap } from "./canvas/layout";
import { isEditable } from "./dom";
import { bounds, type Point } from "./doc/geometry";
import type { Asset, CanvasLink, CanvasNode, Pasted } from "./doc/types";
import { play } from "./juice/sound";
import { checklistData, toMarkdown } from "./checklist/model";
import { fromTsv, tableData, toMarkdown as tableMarkdown } from "./table/model";
import { placeTable } from "./table/table.svelte";
import { joinOps, remapFrame, withMembers } from "./frame/frames.svelte";
import { remapParent, withFamily } from "./parent/parents.svelte";
import { counterData, counterText } from "./counter/model";
import { timerData, timerText } from "./timer/model";
import { runOf } from "./timer/timers.svelte";
import { pinData, pinLabel } from "./pin/model";
import { withFreeSlots } from "./pin/pins.svelte";
import { DEFAULT_TEXT, textData } from "./text/palette";
import { newTextStyle, settings } from "./settings.svelte";

/**
 * Copy, cut and paste.
 *
 * Nodes travel through the webview's own clipboard events as `application/x-patchwork` JSON
 * plus plain text for other apps (text cards' Markdown, or image names). The webview keeps the
 * custom type private to Patchwork, so it round-trips between windows without leaking JSON.
 *
 * Copying a single image instead puts its picture on the system clipboard (like PureRef), so it
 * pastes into other apps. The backend recognizes those pixels when they're pasted back, and the
 * original node is pasted rather than a new embedded image.
 *
 * Everything else (files, images, text from other apps) is read by the backend from the system
 * clipboard, which sidesteps the webviews' restrictions on reading other apps' data.
 */
const MIME = "application/x-patchwork";

interface Payload {
  app: "patchwork";
  v: 1;
  nodes: CanvasNode[];
  assets: Asset[];
  /** Links between the copied nodes. Absent in copies made before links existed. */
  links?: CanvasLink[];
}

/** The last copy, for Paste from the menu (no paste event, so no access to the custom type). */
let last: { payload: Payload; text: string } | null = null;

function payloadOf(nodes: CanvasNode[]): Payload {
  const assets = new Map<string, Asset>();
  for (const n of nodes) {
    const a = doc.assetOf(n);
    if (a) assets.set(a.id, $state.snapshot(a) as Asset);
  }
  return {
    app: "patchwork",
    v: 1,
    nodes: nodes.map((n) => $state.snapshot(n) as CanvasNode),
    assets: [...assets.values()],
    links: doc.linksWithin(nodes.map((n) => n.id)).map((l) => $state.snapshot(l) as CanvasLink),
  };
}

/** What other apps get: text cards' Markdown, checklists as task lists, tables as Markdown tables, counters and pins as a line; otherwise file names. */
function plainText(nodes: CanvasNode[]): string {
  const textOf = (n: CanvasNode): string | null => {
    switch (n.kind) {
      case "text": return textData(n.data).md.trim();
      case "checklist": return toMarkdown(checklistData(n.data));
      case "table": return tableMarkdown(tableData(n.data));
      case "counter": return counterText(counterData(n.data));
      case "timer": return timerText(timerData(n.data), runOf(n.id), Date.now());
      case "pin": return pinLabel(pinData(n.data));
      case "palette": {
        const d = paletteData(n.data);
        return [d.title.trim(), ...d.colors.map((c) => c.hex)].filter(Boolean).join("\n");
      }
      default: return null;
    }
  };
  const texts = nodes.map(textOf).filter((t): t is string => t !== null);
  if (texts.length) return texts.join("\n\n");
  return nodes.map((n) => doc.assetOf(n)?.name ?? "").filter(Boolean).join("\n");
}

/** Copies (or cuts) the selection to the clipboard. */
export function copySelection(cut = false) {
  // Frames bring their members along, parents their children. Cutting takes only what it can
  // remove: locked nodes stay.
  const nodes = withFamily(withMembers(selectedNodes().map((n) => n.id)))
    .map((id) => doc.nodes[id])
    .filter((n) => n && !(cut && n.locked))
    .sort((a, b) => a.z - b.z);
  // Only locked nodes to cut: deleting says they're kept.
  if (!nodes.length) return void (cut && deleteSelection("Cut"));
  const payload = payloadOf(nodes);
  const text = plainText(nodes);
  last = { payload, text };

  const pictured = nodes.length === 1 && (nodes[0].kind === "image" || nodes[0].kind === "gif");
  const image = pictured ? doc.assetOf(nodes[0]) : undefined;
  if (image && !image.missing) {
    // The picture replaces whatever the webview would write, so skip that.
    void backend.copyImage(image).catch((e) => ui.notify(`Couldn't copy the image: ${e}`, "warn"));
    return finishCopy(cut, nodes);
  }

  // execCommand fires a synchronous copy event in which the data can be set; it works from a
  // key press or a click. If it's refused, `last` still serves Paste within this window.
  const fill = (e: ClipboardEvent) => {
    e.clipboardData?.setData("text/plain", text);
    e.clipboardData?.setData(MIME, JSON.stringify(payload));
    e.preventDefault();
  };
  document.addEventListener("copy", fill, { once: true });
  document.execCommand("copy");
  document.removeEventListener("copy", fill);
  finishCopy(cut, nodes);
}

function finishCopy(cut: boolean, nodes: CanvasNode[]) {
  if (cut) deleteSelection("Cut", nodes.map((n) => n.id));
  else play("tap", { pitch: 1.1 });
}

/** Native paste (Ctrl/⌘+V). Editors keep their own paste. */
export function onPaste(e: ClipboardEvent) {
  if (isEditable(e.target)) return;
  e.preventDefault();
  const raw = e.clipboardData?.getData(MIME);
  const payload = raw ? parsePayload(raw) : null;
  if (payload) void pasteNodes(payload, placementPoint());
  else void pasteExternal(placementPoint());
}

/** Paste from a menu or button: uses the last copy if the clipboard still holds it. */
export async function pasteFromMenu(at?: Point) {
  const point = placementPoint(at);
  const pasted = await readClipboard();
  if (pasted && last && pasted.kind === "text" && pasted.text === last.text) return pasteNodes(last.payload, point);
  if (pasted) placeExternal(pasted, point);
}

function parsePayload(raw: string): Payload | null {
  try {
    const p = JSON.parse(raw);
    return p?.app === "patchwork" && Array.isArray(p.nodes) && Array.isArray(p.assets) ? p : null;
  } catch {
    return null;
  }
}

async function pasteNodes(payload: Payload, at: Point) {
  if (!payload.nodes.length) return;
  // Assets may come from another window or a board that's since been closed.
  for (const asset of await backend.registerAssets(payload.assets)) doc.assets[asset.id] ??= asset;

  // Keep the arrangement, centered on the paste point; grid-aligned nodes stay aligned.
  const b = bounds(payload.nodes)!;
  const dx = snap(at.x - (b.x + b.w / 2)), dy = snap(at.y - (b.y + b.h / 2));
  let z = doc.maxZ();
  const ids = new Map(payload.nodes.map((n) => [n.id, crypto.randomUUID()]));
  // Pasted pins take free numbers (or are left out when all nine are taken).
  const nodes = withFreeSlots(
    [...payload.nodes].sort((a, b) => a.z - b.z).map((n) => ({ ...remapParent(remapFrame(n, ids), ids), id: ids.get(n.id)!, x: n.x + dx, y: n.y + dy, z: ++z })),
  );
  if (!nodes.length) return;
  const links = remapLinks(payload.links ?? [], ids);

  history.run(nodes.length > 1 ? `Paste ${nodes.length} nodes` : "Paste", [
    { type: "addNodes", nodes },
    ...joinOps(nodes, at),
    { type: "addLinks", links },
  ]);
  selectOnly(nodes.map((n) => n.id));
  markFresh(nodes.map((n) => n.id));
}

function pastedImageName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `Pasted image ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function readClipboard(): Promise<Pasted | null> {
  try {
    return await backend.readClipboard(pastedImageName());
  } catch (e) {
    ui.notify(`Paste failed: ${e}`, "warn");
    return null;
  }
}

async function pasteExternal(at: Point) {
  const pasted = await readClipboard();
  if (pasted) placeExternal(pasted, at);
}

function placeExternal(pasted: Pasted, at: Point) {
  switch (pasted.kind) {
    case "files":
      return placeAssets(pasted.result, at, "Paste files");
    case "image":
      return placeAssets({ assets: [pasted.asset], skipped: [] }, at, "Paste image");
    case "text":
      return pasteText(pasted.text, at);
    case "own":
      if (last) return void pasteNodes(last.payload, at);
      // A previous session's copy: the bitmap is gone from memory, so treat it as nothing new.
      return ui.notify("Nothing to paste");
    case "empty":
      play("denied", { volume: 0.5 });
      return ui.notify("Nothing to paste");
  }
}

function pasteText(text: string, at: Point) {
  // Hex codes go into the selected palette; a list of nothing but codes becomes a palette.
  const hex = hexCodesIn(text);
  const sel = selectedNodes();
  if (hex.codes.length && sel.length === 1 && isPalette(sel[0])) return addColors(sel[0].id, hex.codes);
  if (hex.only) return placePalette(hex.codes, at);
  // Tab-separated rows (from a spreadsheet) become a table.
  const table = fromTsv(text);
  if (table) return placeTable(table, at);
  const md = text.trim();
  const w = md.length > 280 ? 480 : 320;
  const node: CanvasNode = {
    id: crypto.randomUUID(),
    kind: "text",
    assetId: null,
    x: snap(at.x - w / 2),
    y: snap(at.y - settings.textSize),
    w,
    h: 40, // measured once rendered
    rotation: 0,
    z: doc.maxZ() + 1,
    data: { ...DEFAULT_TEXT, ...newTextStyle(), md },
  };
  history.run("Paste text", [{ type: "addNodes", nodes: [node] }, ...joinOps([node], at)]);
  selectOnly([node.id]);
  markFresh([node.id]);
}
