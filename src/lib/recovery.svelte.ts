import { confirmDiscard, discarded, history, project, save, showBoard, snapshot, ui } from "./app.svelte";
import { backend } from "./backend";
import type { RecoveryMeta } from "./backend/types";
import type { ProjectDoc } from "./doc/types";
import { play } from "./juice/sound";
import { settings } from "./settings.svelte";

/**
 * Autosave, decided with the owner (2026-10-11):
 * - **Recovery copies, always.** A few seconds after a change, while the board has unsaved
 *   changes, its state goes to the app's own folder (\`recovery.rs\`), one copy per board. Saving or
 *   discarding the changes deletes it. After a crash or a forced quit, the next start offers the
 *   copies back (\`RecoveryCard\`).
 * - **Saving into the board file**, with "Save automatically" (on by default since 2026-10-11;
 *   was off at first), for boards that have a file: a few seconds after the changes stop.
 */

/** Wait this long after the last change before writing a recovery copy… */
const RECOVERY_DELAY = 2500;
/** …but never longer than this while changes keep coming. */
const RECOVERY_MAX_WAIT = 20_000;
/** Saving into the file waits for a pause this long. */
const AUTOSAVE_DELAY = 3000;

class RecoveryUi {
  /** Recovery copies from earlier sessions, offered on the card (newest first). */
  offers = $state<RecoveryMeta[]>([]);
  /** The review window is open (RecoveryReview), to look through the copies. */
  reviewing = $state(false);
  /** The pill was put away for this session ("Later"): the copies stay for the next start. */
  later = $state(false);
}
export const recoveryUi = new RecoveryUi();

/** An untitled board's identity for its recovery copy (a new one per untitled board). */
let untitledId: string = crypto.randomUUID();

/** The current board's recovery key. */
export const recoveryKey = () => (project.path ? `path:${project.path}` : `untitled:${untitledId}`);

let recoveryTimer = 0;
let firstPending = 0;
let autosaveTimer = 0;

async function writeRecovery(key: string) {
  firstPending = 0;
  // The board may have been saved or switched meanwhile.
  if (key !== recoveryKey() || !history.dirty) return;
  try {
    await backend.saveRecovery({ key, path: project.path, name: project.name, time: Date.now() }, snapshot());
  } catch (e) {
    console.warn("Recovery copy failed:", e);
  }
}

const deleteRecovery = (key: string) => void backend.deleteRecovery(key).catch(() => {});

/** Starts autosave and recovery (once, at startup), and looks for copies from earlier sessions. */
export function initRecovery() {
  let lastKey = recoveryKey();
  // Discarding the changes (closing, opening another board) throws their copy away too.
  discarded.push(() => deleteRecovery(recoveryKey()));

  $effect.root(() => {
    $effect(() => {
      void history.version;
      const key = recoveryKey(), dirty = history.dirty;
      // The board changed identity: saved under a file for the first time, or another board was
      // opened (after its changes were saved or discarded). The old copy has no use any more.
      if (key !== lastKey) {
        deleteRecovery(lastKey);
        lastKey = key;
      }
      clearTimeout(recoveryTimer);
      clearTimeout(autosaveTimer);
      if (!dirty) {
        firstPending = 0;
        deleteRecovery(key);
        return;
      }
      const now = Date.now();
      if (!firstPending) firstPending = now;
      const wait = Math.max(0, Math.min(RECOVERY_DELAY, firstPending + RECOVERY_MAX_WAIT - now));
      recoveryTimer = window.setTimeout(() => void writeRecovery(key), wait);

      if (settings.autoSave && project.path) autosaveTimer = window.setTimeout(autosave, AUTOSAVE_DELAY);
    });
  });

  void backend
    .listRecoveries()
    .then((list) => {
      recoveryUi.offers = list.filter((m) => m.key !== recoveryKey());
    })
    .catch(() => {});
}

/** Saves into the board's file, quietly; waits while a card is being edited. */
async function autosave() {
  if (!settings.autoSave || !project.path || !history.dirty) return;
  if (ui.editing || ui.editingLink) {
    autosaveTimer = window.setTimeout(autosave, AUTOSAVE_DELAY);
    return;
  }
  await save(false, { quiet: true });
}

/** Opens a recovery copy: the board as it was, its changes unsaved. */
export async function restoreRecovery(meta: RecoveryMeta) {
  if (!(await confirmDiscard())) return;
  try {
    const loaded = await backend.readRecovery(meta.key);
    // Files may have moved or changed since: re-check them and make them servable.
    loaded.assets = await backend.registerAssets(loaded.assets);
    if (meta.key.startsWith("untitled:")) untitledId = meta.key.slice("untitled:".length);
    showBoard(loaded, meta.path);
    // Unsaved, as it was: the copy stays until the board is saved or its changes discarded.
    history.markChanged();
    recoveryUi.offers = recoveryUi.offers.filter((m) => m.key !== meta.key);
    recoveryUi.reviewing = false;
    ui.notify(`Restored “${meta.name}” · not saved yet`);
    play("appear");
  } catch (e) {
    ui.notify(`Couldn't restore: ${e}`, "warn");
  }
}

/** Throws a recovery copy away. */
export function discardRecovery(meta: RecoveryMeta) {
  deleteRecovery(meta.key);
  recoveryUi.offers = recoveryUi.offers.filter((m) => m.key !== meta.key);
  if (!recoveryUi.offers.length) recoveryUi.reviewing = false;
  play("vanish", { volume: 0.5 });
}

/** Throws every offered copy away. */
export function discardAllRecoveries() {
  for (const m of recoveryUi.offers) deleteRecovery(m.key);
  const n = recoveryUi.offers.length;
  recoveryUi.offers = [];
  recoveryUi.reviewing = false;
  play("vanish", { volume: 0.5 });
  ui.notify(n === 1 ? "Discarded 1 unsaved board" : `Discarded ${n} unsaved boards`);
}

/** A copy's board, for the review window's preview (its files made servable). */
export async function readRecoveryPreview(meta: RecoveryMeta): Promise<ProjectDoc> {
  const loaded = await backend.readRecovery(meta.key);
  loaded.assets = await backend.registerAssets(loaded.assets);
  return loaded;
}
