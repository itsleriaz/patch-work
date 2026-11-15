import { SvelteMap } from "svelte/reactivity";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { backend } from "../backend";
import type { Asset } from "../doc/types";
import { PX_PER_PT } from "./model";

/**
 * PDFs, rendered by pdf.js in the webview. Its legacy build matches the app's oldest target
 * (Safari 16); it loads only once a PDF shows up, and parses in a worker.
 *
 * Pages are drawn onto a detached canvas, encoded, and shown as plain images. A live canvas in
 * the camera layer would get its own compositing layer and blur the text around it (HANDOFF §8);
 * an image doesn't. Like image levels, a page is rendered at the size it's shown (`PDF_LEVELS`).
 */

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let lib: Promise<Pdfjs> | undefined;
function pdfjs(): Promise<Pdfjs> {
  lib ??= Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]).then(
    ([m, worker]) => {
      m.GlobalWorkerOptions.workerSrc = worker.default;
      return m;
    },
  );
  return lib;
}

/** Page counts of the documents opened so far, by content hash. */
export const pdfPages = new SvelteMap<string, number>();
/** Why a document couldn't be opened, by content hash. */
export const pdfErrors = new SvelteMap<string, string>();

// ---------------------------------------------------------------- documents

interface OpenDoc {
  doc: Promise<PDFDocumentProxy>;
  lastUse: number;
  /** Renders in progress: the document stays open while any run. */
  busy: number;
}
/** Open documents by content hash. Failed ones stay, so they aren't retried on every render. */
const docs = new Map<string, OpenDoc>();
/** A document unused this long is closed (its worker memory freed); it reopens when needed. */
const IDLE_MS = 60_000;
let sweeper: ReturnType<typeof setInterval> | undefined;

async function load(asset: Asset): Promise<PDFDocumentProxy> {
  const m = await pdfjs();
  const res = await fetch(backend.assetUrl(asset, "full"));
  if (!res.ok) throw new Error(`couldn't read the file (${res.status})`);
  const data = new Uint8Array(await res.arrayBuffer());
  const base = new URL("/pdfjs/", location.href).href;
  return m.getDocument({
    data,
    cMapUrl: `${base}cmaps/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
    // The bundled standard fonts, not whatever the system has: pages look the same everywhere.
    useSystemFonts: false,
    enableXfa: false,
    verbosity: m.VerbosityLevel.ERRORS,
  }).promise;
}

function openDoc(asset: Asset): OpenDoc {
  let entry = docs.get(asset.hash);
  if (!entry) {
    const doc = load(asset);
    entry = { doc, lastUse: 0, busy: 0 };
    docs.set(asset.hash, entry);
    doc.then(
      (d) => pdfPages.set(asset.hash, d.numPages),
      (e: unknown) => {
        const name = (e as { name?: string })?.name;
        pdfErrors.set(asset.hash, name === "PasswordException" ? "This PDF is password-protected" : "Can't open this PDF");
        console.warn(`Can't open ${asset.name}: ${(e as Error)?.message ?? e}`);
      },
    );
    sweeper ??= setInterval(sweep, IDLE_MS / 2);
  }
  entry.lastUse = performance.now();
  return entry;
}

function sweep() {
  const now = performance.now();
  for (const [hash, entry] of docs) {
    if (entry.busy || now - entry.lastUse < IDLE_MS || pdfErrors.has(hash)) continue;
    docs.delete(hash);
    void entry.doc.then((d) => d.loadingTask.destroy());
  }
  if (![...docs.keys()].some((h) => !pdfErrors.has(h))) {
    clearInterval(sweeper);
    sweeper = undefined;
  }
}

/** Every page's size in CSS pixels. */
export async function pageSizes(asset: Asset): Promise<{ w: number; h: number }[]> {
  const entry = openDoc(asset);
  entry.busy++;
  try {
    const doc = await entry.doc;
    const sizes = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const v = (await doc.getPage(i)).getViewport({ scale: 1 });
      sizes.push({ w: v.width * PX_PER_PT, h: v.height * PX_PER_PT });
    }
    return sizes;
  } finally {
    entry.busy--;
    entry.lastUse = performance.now();
  }
}

/** A new PDF's first page size (CSS px), for its node; null when it can't be opened. */
export async function probePdf(asset: Asset): Promise<{ width: number; height: number } | null> {
  try {
    const entry = openDoc(asset);
    const page = await (await entry.doc).getPage(1);
    const v = page.getViewport({ scale: 1 });
    return { width: Math.round(v.width * PX_PER_PT), height: Math.round(v.height * PX_PER_PT) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- rendering

interface Render {
  /** An object URL of the page's picture; null if it couldn't be drawn. */
  url: Promise<string | null>;
  users: number;
}
/** Rendered pages by `hash:page:level`, least recently used first. */
const renders = new Map<string, Render>();
/** Pictures kept for reuse once nothing shows them (flipping back, zooming out and in). */
const KEEP = 48;
/** Pages drawn at once. Drawing is on the main thread; parsing is in the worker. */
const PARALLEL = 2;

let running = 0;
/** Waiting renders, newest last: the newest runs first, as it's what was asked for last (zooming, flipping). */
const waiting: (() => void)[] = [];

function next() {
  while (running < PARALLEL && waiting.length) {
    running++;
    waiting.pop()!();
  }
}

async function draw(asset: Asset, page: number, level: number): Promise<string | null> {
  const entry = openDoc(asset);
  entry.busy++;
  const canvas = document.createElement("canvas");
  try {
    const doc = await entry.doc;
    const p = await doc.getPage(Math.min(page, doc.numPages - 1) + 1);
    const base = p.getViewport({ scale: 1 });
    const viewport = p.getViewport({ scale: level / Math.max(base.width, base.height) });
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    await p.render({ canvas, viewport }).promise;
    // Small levels show about 1:1, where JPEG would fringe the text; big ones encode 4–5× faster as JPEG.
    const [type, quality] = level <= 1024 ? ["image/png", undefined] : ["image/jpeg", 0.92];
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    p.cleanup();
    return blob && URL.createObjectURL(blob);
  } catch (e) {
    if (!pdfErrors.has(asset.hash)) console.warn(`Couldn't draw page ${page + 1} of ${asset.name}: ${(e as Error)?.message ?? e}`);
    return null;
  } finally {
    canvas.width = canvas.height = 0; // frees the bitmap now
    entry.busy--;
    entry.lastUse = performance.now();
  }
}

/** Drops the least recently used pictures nothing shows, beyond `KEEP`. */
function trim() {
  let unused = 0;
  for (const r of renders.values()) if (!r.users) unused++;
  for (const [key, r] of renders) {
    if (unused <= KEEP) break;
    if (r.users) continue;
    renders.delete(key);
    unused--;
    void r.url.then((url) => url && URL.revokeObjectURL(url));
  }
}

export interface PageImage {
  url: Promise<string | null>;
  release(): void;
}

/**
 * A picture of a page, `level` px on its longest side. Call `release` once it's no longer shown;
 * the picture stays cached a while (`KEEP`) and is only revoked when nothing shows it.
 */
export function acquirePage(asset: Asset, page: number, level: number): PageImage {
  const key = `${asset.hash}:${page}:${level}`;
  let r = renders.get(key);
  if (r) renders.delete(key); // re-added below as the most recent
  else {
    const entry: Render = { users: 0, url: Promise.resolve(null) };
    entry.url = new Promise<void>((resolve) => {
      waiting.push(resolve);
      next();
    }).then(async () => {
      try {
        // Dropped while it waited: nothing wants it any more.
        return renders.get(key) === entry ? await draw(asset, page, level) : null;
      } finally {
        running--;
        next();
      }
    });
    r = entry;
  }
  renders.set(key, r);
  r.users++;
  const held = r;
  let released = false;
  return {
    url: r.url,
    release() {
      if (released) return;
      released = true;
      held.users--;
      trim();
    },
  };
}

/** Renders a page ahead of time (the next one, while reading), keeping it cached. */
export function prefetchPage(asset: Asset, page: number, level: number) {
  acquirePage(asset, page, level).release();
}
