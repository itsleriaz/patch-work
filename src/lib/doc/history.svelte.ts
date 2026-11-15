import type { Doc } from "./document.svelte";
import { applyOp, type Op } from "./ops.svelte";

export interface Entry {
  label: string;
  forward: Op[];
  /** Already in the order they must be applied to undo. */
  backward: Op[];
  /** When it was recorded (ms since the epoch). */
  time: number;
}

/** The nodes a step adds, removes or changes (for highlighting and the undo wiggle). */
export function touchedNodes(entry: Entry): string[] {
  const ids = new Set<string>();
  const walk = (op: Op) => {
    switch (op.type) {
      case "addNodes": for (const n of op.nodes) ids.add(n.id); break;
      case "removeNodes": for (const id of op.ids) ids.add(id); break;
      case "updateNodes": for (const c of op.changes) ids.add(c.id); break;
      case "batch": op.ops.forEach(walk); break;
      default: break;
    }
  };
  entry.forward.forEach(walk);
  return [...ids];
}

export class History {
  #undo = $state.raw<Entry[]>([]);
  #redo = $state.raw<Entry[]>([]);
  /** Undo-stack top at the last save; the document is dirty when it differs. */
  #savedTop = $state.raw<Entry | undefined>(undefined);

  private doc: Doc;

  constructor(doc: Doc) {
    this.doc = doc;
  }

  /** Changes outside the undo stack (asset storage, board settings) since the last save. */
  #changed = $state(false);

  /** Every step, oldest first: the applied ones, then the ones that can be redone. */
  entries = $derived([...this.#undo, ...[...this.#redo].reverse()]);
  /** How many steps are applied: `entries[position - 1]` is the current one, 0 the start. */
  position = $derived(this.#undo.length);
  /** Where the board was last saved, as a position (0: the start), or null if it was never saved there. */
  savedAt = $derived(this.#savedTop === undefined ? 0 : this.entries.indexOf(this.#savedTop) + 1 || null);

  /** Bumped on every change to the history or the saved state (autosave and recovery watch it). */
  version = $state(0);

  canUndo = $derived(this.#undo.length > 0);
  canRedo = $derived(this.#redo.length > 0);
  dirty = $derived(this.#changed || this.#undo.at(-1) !== this.#savedTop);

  /**
   * Changes applied live but not recorded yet (a burst of counter clicks, merged into one step
   * once it settles). Each flusher records its pending change; they run before anything else
   * touches history, so steps stay in order and undo never skips one.
   */
  #flushers: (() => void)[] = [];

  addFlusher(flush: () => void) {
    this.#flushers.push(flush);
  }

  #flush() {
    for (const f of this.#flushers) f();
  }

  /** Marks the document unsaved for a change that isn't an undoable op. */
  markChanged() {
    this.version++;
    this.#changed = true;
  }

  /** Applies ops and records them as one undoable step. */
  run(label: string, ops: Op[]) {
    if (ops.length === 0) return;
    this.#flush();
    const backward = ops.map((op) => applyOp(this.doc, op)).reverse();
    this.#push({ label, forward: ops, backward, time: Date.now() });
  }

  /** Records a step whose effect is already applied (e.g. a live drag). */
  record(label: string, forward: Op[], backward: Op[]) {
    if (forward.length === 0) return;
    this.#flush();
    this.#push({ label, forward, backward: [...backward].reverse(), time: Date.now() });
  }

  /** Undoes the last step; returns it. */
  undo(): Entry | undefined {
    this.version++;
    this.#flush();
    const entry = this.#undo.at(-1);
    if (!entry) return;
    for (const op of entry.backward) applyOp(this.doc, op);
    this.#undo = this.#undo.slice(0, -1);
    this.#redo = [...this.#redo, entry];
    return entry;
  }

  /** Redoes the next step; returns it. */
  redo(): Entry | undefined {
    this.version++;
    this.#flush();
    const entry = this.#redo.at(-1);
    if (!entry) return;
    for (const op of entry.forward) applyOp(this.doc, op);
    this.#redo = this.#redo.slice(0, -1);
    this.#undo = [...this.#undo, entry];
    return entry;
  }

  markSaved() {
    this.version++;
    this.#flush();
    this.#savedTop = this.#undo.at(-1);
    this.#changed = false;
  }

  clear() {
    this.version++;
    this.#flush();
    this.#undo = [];
    this.#redo = [];
    this.#savedTop = undefined;
    this.#changed = false;
  }

  #push(entry: Entry) {
    this.version++;
    this.#undo = [...this.#undo, entry];
    this.#redo = [];
  }
}
