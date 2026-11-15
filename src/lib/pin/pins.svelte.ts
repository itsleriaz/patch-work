import { camera, doc, history, markFresh, selectedNodes, selection, selectOnly, ui } from "../app.svelte";
import type { Point } from "../doc/geometry";
import type { Op } from "../doc/ops.svelte";
import type { CameraState, CanvasNode } from "../doc/types";
import { frameAt, frames, joinOps, reassign } from "../frame/frames.svelte";
import { carryChildren, familyTargets } from "../parent/parents.svelte";
import { play } from "../juice/sound";
import { isMac } from "../platform";
import { settings } from "../settings.svelte";
import { DEFAULT_PIN, isPin, MAX_PINS, pinData, pinLabel, type PinColor, type PinData } from "./model";

class PinUi {
  /** A pin whose title is being edited inline. */
  editing = $state<string | null>(null);
  /** The pin a jump just arrived at, to bounce; `key` replays it. */
  arrived = $state<{ id: string; key: number } | null>(null);
}
export const pinUi = new PinUi();

class Pins {
  /** Every pin, by number. */
  list = $derived(doc.nodeList.filter(isPin).sort((a, b) => pinData(a.data).slot - pinData(b.data).slot));
}
export const pins = new Pins();

const slotOf = (n: CanvasNode) => pinData(n.data).slot;

/** The pin on this number key. */
export const pinOn = (slot: number) => pins.list.find((n) => slotOf(n) === slot);

/** The lowest number no pin has, or null when all nine are taken. */
export function freeSlot(taken: Set<number> = new Set(pins.list.map(slotOf))): number | null {
  for (let s = 1; s <= MAX_PINS; s++) if (!taken.has(s)) return s;
  return null;
}

const shiftKey = (slot: number) => (isMac ? `⇧${slot}` : `Shift+${slot}`);

// ---------------------------------------------------------------- jumping

/** The last jump: where it arrived and where it started, so pressing the number again goes back. */
let last: { slot: number; arrive: CameraState; from: CameraState } | null = null;

/** The view centered on a pin at its zoom. A pin hidden in a collapsed frame is at that frame. */
function viewOf(pin: CanvasNode): CameraState {
  const zoom = pinData(pin.data).zoom;
  const owner = frames.hidden.has(pin.id) ? frames.owner.get(pin.id) : undefined;
  const f = owner ? doc.nodes[owner] : undefined;
  const p = f ? { x: f.x + f.w / 2, y: f.y + f.h / 2 } : { x: pin.x, y: pin.y };
  return { zoom, x: camera.centerX - p.x * zoom, y: camera.height / 2 - p.y * zoom };
}

const same = (a: CameraState, b: CameraState) =>
  Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.zoom / b.zoom - 1) < 1e-3;

function fly(to: CameraState, arrived?: () => void) {
  if (settings.calm) camera.animateTo(to, 280);
  else camera.flyTo(to, arrived);
}

/** Flies to pin `slot`. Pressed again while there, it flies back to where the jump started. */
export function jumpToPin(slot: number) {
  const pin = pinOn(slot);
  if (!pin) {
    play("denied", { volume: 0.4 });
    ui.notify(`No pin ${slot} yet · ${shiftKey(slot)} pins this view`);
    return;
  }
  if (last?.slot === slot && same(camera.state, last.arrive)) {
    const back = last.from;
    last = null;
    fly(back);
    play("swipe", { volume: 0.6, pitch: 0.85 });
    return;
  }
  goTo(pin, slot);
}

/** Flies to a pin, remembering where from (so its number key can fly back). */
function goTo(pin: CanvasNode, slot: number) {
  const arrive = viewOf(pin);
  last = { slot, arrive, from: camera.state };
  fly(arrive, () => {
    pinUi.arrived = { id: pin.id, key: performance.now() };
    play("select", { volume: 0.5 });
  });
  play("swipe", { volume: 0.7 });
}

/**
 * Steps to the next (or previous) pin by number, from the last one jumped to, wrapping around:
 * a simple tour of the board. Page Down / Page Up, which presentation clickers send, or ] / [.
 */
export function stepPin(dir: 1 | -1) {
  const list = [...pins.list].sort((a, b) => slotOf(a) - slotOf(b));
  if (!list.length) {
    play("denied", { volume: 0.4 });
    return void ui.notify("No pins yet · Shift+1–9 pins this view");
  }
  const from = last?.slot ?? (dir > 0 ? 0 : MAX_PINS + 1);
  const next = dir > 0 ? (list.find((p) => slotOf(p) > from) ?? list[0]) : ([...list].reverse().find((p) => slotOf(p) < from) ?? list[list.length - 1]);
  goTo(next, slotOf(next));
  ui.notify(pinLabel(pinData(next.data)));
}

// ---------------------------------------------------------------- placing

function addPin(slot: number, at: Point, zoom: number): CanvasNode {
  const node: CanvasNode = {
    id: crypto.randomUUID(),
    kind: "pin",
    assetId: null,
    x: at.x,
    y: at.y,
    w: 0,
    h: 0,
    rotation: 0,
    z: doc.maxZ() + 1,
    data: { ...DEFAULT_PIN, slot, zoom },
  };
  history.run(`Add pin ${slot}`, [{ type: "addNodes", nodes: [node] }, ...joinOps([node], at)]);
  markFresh([node.id]);
  return node;
}

/** A new pin at `at` with the lowest free number, saving the current zoom; its title editor opens. */
export function createPin(at: Point) {
  const slot = freeSlot();
  if (slot === null) return void ui.notify("All 9 pins are in use", "warn");
  const pin = addPin(slot, at, camera.zoom);
  selectOnly([pin.id]);
  pinUi.editing = pin.id;
}

/**
 * Pins the current view on number `slot`: a pin in the middle of the view with the current zoom,
 * so jumping to it brings this view back. Pin `slot` moves here if it exists.
 */
export function pinView(slot: number) {
  const at = camera.toWorld(camera.centerX, camera.height / 2);
  const zoom = camera.zoom;
  last = null;
  const pin = pinOn(slot);
  if (!pin) {
    addPin(slot, at, zoom);
    ui.notify(`Pinned this view on ${slot}`);
    return;
  }
  if (pin.locked) {
    ui.notify(`Pin ${slot} is locked`, "warn");
    play("denied", { volume: 0.5 });
    return;
  }
  const ops: Op[] = [{ type: "updateNodes", changes: carryChildren([{ id: pin.id, props: { x: at.x, y: at.y, data: { ...pinData(pin.data), zoom } } }]) }];
  // It belongs to the frame it lands in now (or none).
  const into = frameAt(at, new Set(), true);
  if (into !== (frames.owner.get(pin.id) ?? null)) ops.push(...reassign(familyTargets(new Map([[pin.id, into]]))));
  history.run(`Move pin ${slot}`, ops);
  pinUi.arrived = { id: pin.id, key: performance.now() };
  play("appear");
  ui.notify(`Moved pin ${slot} to this view`);
}

/**
 * Pasted or duplicated nodes with numbers for their pins: each keeps its own if free, else gets
 * the lowest free one. Pins that don't fit (all nine taken) are left out.
 */
export function withFreeSlots(nodes: CanvasNode[]): CanvasNode[] {
  const taken = new Set(pins.list.map(slotOf));
  let left = 0;
  const out: CanvasNode[] = [];
  for (const n of nodes) {
    if (!isPin(n)) {
      out.push(n);
      continue;
    }
    const own = slotOf(n);
    const slot = taken.has(own) ? freeSlot(taken) : own;
    if (slot === null) {
      left++;
      continue;
    }
    taken.add(slot);
    out.push({ ...n, data: { ...pinData(n.data), slot } });
  }
  if (left) ui.notify(`All 9 pins are in use: ${left === 1 ? "a pin was" : `${left} pins were`} left out`, "warn");
  return out;
}

export function setPin(pin: CanvasNode, label: string, patch: Partial<PinData>) {
  const d = pinData(pin.data);
  const next = { ...d, ...patch };
  if (JSON.stringify(next) !== JSON.stringify(d)) {
    history.run(label, [{ type: "updateNodes", changes: [{ id: pin.id, props: { data: next } }] }]);
  }
}

/** Colors the selected pins, as one step. */
export function setPinColor(color: PinColor) {
  play("button", { volume: 0.5 });
  const changes = selectedNodes()
    .filter(isPin)
    .map((n) => ({ id: n.id, props: { data: { ...pinData(n.data), color } } }));
  if (changes.length) history.run("Pin color", [{ type: "updateNodes", changes }]);
}

export function deletePin(pin: CanvasNode) {
  history.run(`Delete pin ${slotOf(pin)}`, [{ type: "removeNodes", ids: [pin.id] }]);
  selection.delete(pin.id);
  play("vanish");
}
