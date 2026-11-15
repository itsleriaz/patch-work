import { doc, history, project, save, ui } from "./app.svelte";
import { backend } from "./backend";
import type { Asset } from "./doc/types";
import type { RelinkProgress } from "./backend/types";
import { play } from "./juice/sound";
import { settings } from "./settings.svelte";

/**
 * Storage operations on the board's files. The backend returns the assets updated (same ids
 * and hashes, new storage or path) and they're swapped into the document; nodes don't change.
 * These aren't undoable: they only ever add files on disk. Operations that move bytes in or out
 * of the board file save it, so the board and the disk agree.
 */

function used() {
  return doc.usedAssets();
}

/** Counts for the board menu, e.g. "38 linked · 4 embedded · 1 missing". */
export function storageSummary(): string {
  const assets = used();
  if (!assets.length) return "No files";
  const linked = assets.filter((a) => a.storage === "linked").length;
  const embedded = assets.length - linked;
  const missing = assets.filter((a) => a.missing).length;
  return [linked && `${linked} linked`, embedded && `${embedded} embedded`, missing && `${missing} missing`]
    .filter(Boolean)
    .join(" · ");
}

export const hasLinked = () => used().some((a) => a.storage === "linked" && !a.missing);
export const hasEmbedded = () => used().some((a) => a.storage === "embedded" && !a.missing);
export const hasMissing = () => used().some((a) => a.missing);

function swapIn(updated: Asset[]) {
  for (const a of updated) doc.assets[a.id] = a;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Collect and unpack write next to the board, so it needs a place on disk first. */
async function boardPath(): Promise<string | null> {
  if (project.path) return project.path;
  ui.notify("Save the board first, so its files have somewhere to go");
  return (await save()) ? project.path : null;
}

async function run(
  label: string,
  work: () => Promise<Asset[]>,
  done: (n: number) => string,
  { none = `${label}: nothing to do` as string | (() => string), saveAfter = true } = {},
) {
  try {
    const before = new Map(used().map((a) => [a.id, `${a.storage}:${a.path}`]));
    const updated = await work();
    const changed = updated.filter((a) => before.get(a.id) !== `${a.storage}:${a.path}`).length;
    swapIn(updated);
    if (!changed) return ui.notify(typeof none === "function" ? none() : none);
    history.markChanged();
    if (saveAfter && project.path) await save();
    play("done");
    ui.notify(done(changed));
  } catch (e) {
    ui.notify(`${label} failed: ${e}`, "warn");
  }
}

export async function collectFiles() {
  const path = await boardPath();
  if (!path) return;
  const dir = await backend.filesDir(path);
  const n = used().filter((a) => a.storage === "linked" && !a.missing).length;
  const ok = await backend.confirm(
    `Copy linked files into “${dir}” and link to the copies?\n\nThe originals stay where they are. Moving the board together with that folder keeps everything working. The board will be saved.`,
    `Collect ${plural(n, "file")}`,
  );
  if (ok) await run("Collect", () => backend.collectAssets(path, used()), (k) => `Copied ${plural(k, "file")} next to the board`);
}

export async function packBoard() {
  const assets = used();
  const linked = assets.filter((a) => a.storage === "linked" && !a.missing);
  const mb = linked.reduce((s, a) => s + a.size, 0) / 1e6;
  const ok = await backend.confirm(
    `Embed ${plural(linked.length, "linked file")} (${mb.toFixed(1)} MB) in the board file?\n\nThe board becomes a single file you can move or share. The originals stay where they are.${project.path ? " The board will be saved." : ""}`,
    "Pack board",
  );
  if (ok) await run("Pack", () => backend.packAssets(assets), (k) => `Embedded ${plural(k, "file")} in the board`);
}

export async function unpackBoard() {
  const path = await boardPath();
  if (!path) return;
  const dir = await backend.filesDir(path);
  const n = used().filter((a) => a.storage === "embedded" && !a.missing).length;
  const ok = await backend.confirm(
    `Write ${plural(n, "embedded file")} into “${dir}” and link to them?\n\nPacked files keep their original folders; pasted ones go to “Pasted images”. The board will be saved.`,
    "Unpack board",
  );
  if (ok) await run("Unpack", () => backend.unpackAssets(path, used()), (k) => `Unpacked ${plural(k, "file")} next to the board`);
}

/**
 * Looks for the board's missing files in a folder the user picks (down to the "Missing files"
 * search depth setting), with a progress card that can stop the search (keeping what was found).
 */
export async function relinkMissing() {
  const missing = used().filter((a) => a.missing).length;
  if (!missing) return ui.notify("No files are missing");
  if (ui.task) return;
  const dir = await backend.pickFolder(`Find ${plural(missing, "missing file")} in…`);
  if (!dir) return;
  ui.dismissToast();
  let stopped = false;
  ui.task = {
    title: `Looking for ${plural(missing, "missing file")}`,
    detail: "Starting…",
    stop: () => {
      stopped = true;
      void backend.cancelRelink();
    },
  };
  const depth = settings.relinkDepth || null;
  const progress = (p: RelinkProgress) => {
    if (ui.task) ui.task = { ...ui.task, detail: `${p.scanned.toLocaleString()} files looked at · found ${p.found} of ${p.missing}`, folder: p.folder };
  };
  try {
    await run(
      "Relink",
      () => backend.relinkAssets(dir, used(), depth, progress),
      (k) => {
        const what = k < missing ? `found ${k} of ${plural(missing, "missing file")}` : k === 1 ? "found the missing file" : `found all ${k} missing files`;
        return stopped ? `Stopped: ${what}` : what[0].toUpperCase() + what.slice(1);
      },
      { none: () => (stopped ? "Stopped: none found yet" : "None of the missing files are in that folder"), saveAfter: false },
    );
  } finally {
    ui.task = null;
  }
}

/**
 * Lets the blob store (embedded files' bytes, kept while the app runs) drop what hasn't been used
 * for 30 days. Kept: every embedded file the open board knows of (undo can bring deleted ones
 * back) and what the clipboard holds. Run quietly a little after startup.
 */
export async function cleanBlobStore(extra: Asset[] = []) {
  const keep = [...Object.values(doc.assets), ...extra].filter((a) => a.storage === "embedded").map((a) => a.hash);
  try {
    const { removed, bytes } = await backend.cleanBlobs(keep);
    if (removed) console.info(`Blob store: removed ${removed} unused file(s), ${(bytes / 1e6).toFixed(1)} MB`);
  } catch (e) {
    console.warn("Blob store cleanup failed:", e);
  }
}

export function toggleEmbedNew() {
  project.board.embedNew = !project.board.embedNew;
  history.markChanged();
}
