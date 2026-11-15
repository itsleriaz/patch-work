/**
 * A counter node's content. Integers only, never below 0. With a goal it counts up to it and
 * stops there (a goal is a target to reach, not just a clamp); without one it's an open tally.
 */

// A type alias, not an interface: node data is typed Record<string, unknown>.
export type CounterData = {
  label: string;
  value: number;
  /** How much one click changes the value (Shift+click: ten times that). */
  step: number;
  /** The target to reach; null for an open tally. */
  goal: number | null;
  /** World units; the card scales with it, like text and checklists. */
  fontSize: number;
};

export const DEFAULT_COUNTER: CounterData = { label: "", value: 0, step: 1, goal: null, fontSize: 18 };

/** Counter data with defaults filled in and values made sane. */
export function counterData(data: unknown): CounterData {
  const d = { ...DEFAULT_COUNTER, ...(data as Partial<CounterData> | null) };
  const goal = d.goal && d.goal > 0 ? Math.round(d.goal) : null;
  return { ...d, goal, step: Math.max(1, Math.round(d.step) || 1), value: clampCount(d.value, goal) };
}

/** A whole number from 0 up to the goal (when there is one). */
export function clampCount(value: number, goal: number | null): number {
  const v = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
  return goal ? Math.min(v, goal) : v;
}

/** "Label: 7 / 10" (for other apps). */
export function counterText(d: CounterData): string {
  return `${d.label.trim() || "Counter"}: ${d.value}${d.goal ? ` / ${d.goal}` : ""}`;
}
