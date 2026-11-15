import { doc, history } from "../app.svelte";
import type { Op } from "../doc/ops.svelte";
import { play } from "../juice/sound";
import { clampCount, counterData, type CounterData } from "./model";

/**
 * Counting. Clicks change the value live; a burst of them becomes one undo step ("Count 3 → 8")
 * once it settles. History flushes a pending burst before anything else touches it.
 */
const SETTLE_MS = 900;

interface Burst {
  from: CounterData;
  timer: ReturnType<typeof setTimeout>;
}
const bursts = new Map<string, Burst>();

class CounterUi {
  /** An inline editor open on a counter's field. */
  editing = $state<{ nodeId: string; field: "label" | "value" | "goal" | "step" } | null>(null);
  /** Bumped when a count hits its limit, so the card can shake (keyed by node). */
  blocked = $state<{ nodeId: string; n: number } | null>(null);
}
export const counterUi = new CounterUi();

function flush(id: string) {
  const burst = bursts.get(id);
  if (!burst) return;
  bursts.delete(id);
  clearTimeout(burst.timer);
  const node = doc.nodes[id];
  if (!node) return;
  const now = counterData($state.snapshot(node.data));
  if (now.value === burst.from.value) return;
  const change = (data: CounterData): Op[] => [{ type: "updateNodes", changes: [{ id, props: { data } }] }];
  history.record(`Count ${burst.from.value} → ${now.value}`, change(now), change(burst.from));
}

export function flushAllCounts() {
  for (const id of [...bursts.keys()]) flush(id);
}
history.addFlusher(flushAllCounts);

/** Changes a counter by `steps` of its step size. Returns false when a limit stopped it. */
export function count(id: string, steps: number): boolean {
  const node = doc.nodes[id];
  if (!node || node.kind !== "counter") return false;
  const d = counterData($state.snapshot(node.data));
  const next = clampCount(d.value + steps * d.step, d.goal);
  if (next === d.value) {
    play("denied", { volume: 0.4, throttle: 120 });
    counterUi.blocked = { nodeId: id, n: (counterUi.blocked?.n ?? 0) + 1 };
    return false;
  }
  // The first click of a burst remembers where it started (and isn't flushed by itself).
  let burst = bursts.get(id);
  if (!burst) {
    burst = { from: d, timer: 0 as unknown as ReturnType<typeof setTimeout> };
    bursts.set(id, burst);
  }
  clearTimeout(burst.timer);
  burst.timer = setTimeout(() => flush(id), SETTLE_MS);
  node.data = { ...d, value: next };
  // The tick climbs as the count does (up to a point), and dips going down.
  const up = next > d.value;
  play("tap", { volume: 0.5, throttle: 30, pitch: (up ? 1.05 : 0.9) + Math.min(next, 40) * 0.008 });
  return true;
}

/** Sets fields as one undo step (typed value, goal, step, label, reset). */
export function setCounter(id: string, label: string, patch: Partial<CounterData>) {
  const node = doc.nodes[id];
  if (!node || node.kind !== "counter") return;
  const d = counterData($state.snapshot(node.data));
  const next = counterData({ ...d, ...patch });
  if (JSON.stringify(next) === JSON.stringify(d)) return;
  history.run(label, [{ type: "updateNodes", changes: [{ id, props: { data: next } }] }]);
}
