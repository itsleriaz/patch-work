import { doc, history, markFresh, project, selectOnly, ui } from "../app.svelte";
import { backend } from "../backend";
import { snap } from "../canvas/layout";
import type { Point } from "../doc/geometry";
import type { CanvasNode } from "../doc/types";
import { joinOps } from "../frame/frames.svelte";
import { play } from "../juice/sound";
import { flyToNode, inView } from "../outline/outline.svelte";
import type { MenuEntry } from "../ui/Menu.svelte";
import { DEFAULT_TIMER, elapsed, formatTime, IDLE, isTimer, shown, timerData, type TimerData, type TimerMode, type TimerRun } from "./model";

/**
 * Timers at run time. Runs live in the board (`project.board.timers`, by node id): changing one
 * marks the board unsaved (`history.markChanged`) but is never an undo step. One clock ticks while
 * any timer runs, on a plain interval (it keeps going, slowed, when the window is hidden), and
 * finishes countdowns that reach zero: a chime, a pulse, a toast when the timer is off-screen, and
 * a system notification when the app isn't in front. A countdown that ran out while the board was
 * closed (or long ago) just shows Done, without the alarm.
 */

class TimerUi {
  /** The clock every timer reads (ms since the epoch); updated while any timer runs. */
  now = $state(Date.now());
  /** An inline editor open on a timer. */
  editing = $state<{ nodeId: string; field: "label" | "duration" } | null>(null);
  /** The timer whose card opened the lengths menu. */
  menu = $state<string | null>(null);
  /** Timers that just finished: a token whose change restarts the pulse. */
  rang = $state<Record<string, number>>({});
  /**
   * Countdowns that finished while likely unwatched (the app not in front, the timer off-screen,
   * or the board closed), by when they reached zero; the navigator's bell lists them. For this
   * session only. One leaves when its timer is started or reset, or is gone to from the list.
   */
  missed = $state<{ id: string; at: number }[]>([]);
}
export const timerUi = new TimerUi();

export const runOf = (id: string): TimerRun => project.board.timers?.[id] ?? IDLE;
export const isRunning = (id: string) => runOf(id).startedAt !== null;

/** Replaces a timer's run (null: reset). Saved with the board, not undoable. */
function setRun(id: string, run: TimerRun | null) {
  // Started again or reset: whatever was missed about it is dealt with.
  if (!run || run.startedAt !== null) forgetMissed(id);
  const timers = { ...(project.board.timers ?? {}) };
  if (run) timers[id] = run;
  else delete timers[id];
  project.board.timers = timers;
  history.markChanged();
  timerUi.now = Date.now();
  tickWhileRunning();
}

/** Timers running on this board (nodes that exist). */
export function runningTimers(): CanvasNode[] {
  return Object.entries(project.board.timers ?? {})
    .filter(([id, run]) => run.startedAt !== null && isTimer(doc.nodes[id]))
    .map(([id]) => doc.nodes[id]);
}

// ---------------------------------------------------------------- the clock

/** A finish this long after the countdown actually reached zero is quiet (the board was closed). */
const LATE_MS = 5000;
let interval: ReturnType<typeof setInterval> | null = null;

export function tickWhileRunning() {
  if (interval || !runningTimers().length) return;
  interval = setInterval(tick, 100);
}

function tick() {
  const now = Date.now();
  timerUi.now = now;
  const running = runningTimers();
  for (const n of running) {
    const d = timerData(n.data), run = runOf(n.id);
    if (d.mode !== "countdown" || elapsed(run, now) < d.duration) continue;
    const zeroAt = (run.startedAt ?? now) + (d.duration - run.banked);
    finish(n, now - zeroAt > LATE_MS, zeroAt);
  }
  if (!runningTimers().length && interval) {
    clearInterval(interval);
    interval = null;
  }
}

function finish(n: CanvasNode, quietly: boolean, zeroAt: number) {
  const d = timerData(n.data);
  setRun(n.id, { startedAt: null, banked: d.duration, laps: [], done: true });
  // Seen if it rang in view while the app was in front; otherwise it waits under the bell.
  if (quietly || document.hidden || !document.hasFocus() || !inView(n)) timerUi.missed = [...timerUi.missed.filter((m) => m.id !== n.id), { id: n.id, at: zeroAt }];
  if (quietly) return;
  timerUi.rang = { ...timerUi.rang, [n.id]: (timerUi.rang[n.id] ?? 0) + 1 };
  play("done", { volume: 0.9 });
  const name = d.label.trim() || "Timer";
  if (!inView(n)) ui.notify(`${name}: done`, "info", { label: "Show", run: () => showMissed(n.id) });
  if (!document.hasFocus()) void backend.notify(name, `${formatTime(d.duration)} timer done`);
}

/** Takes a timer off the missed list. */
export function forgetMissed(id: string) {
  if (timerUi.missed.some((m) => m.id === id)) timerUi.missed = timerUi.missed.filter((m) => m.id !== id);
}

export const clearMissed = () => (timerUi.missed = []);

/** The missed timers still on this board, newest first. */
export function missedTimers(): { node: CanvasNode; at: number; name: string }[] {
  return timerUi.missed
    .filter((m) => isTimer(doc.nodes[m.id]))
    .map((m) => ({ node: doc.nodes[m.id], at: m.at, name: timerData(doc.nodes[m.id].data).label.trim() || "Timer" }))
    .sort((a, b) => b.at - a.at);
}

/** Goes to a missed timer (selects it and flies there), which counts as seeing it. */
export function showMissed(id: string) {
  forgetMissed(id);
  selectOnly([id]);
  flyToNode(id);
}

// ---------------------------------------------------------------- commands

export function startTimer(id: string) {
  const n = doc.nodes[id];
  if (!isTimer(n) || isRunning(id)) return;
  const run = runOf(id);
  // A finished countdown starts over.
  setRun(id, run.done ? { ...IDLE, startedAt: Date.now() } : { ...run, laps: [...run.laps], startedAt: Date.now() });
  play("toggleOn", { volume: 0.5 });
}

export function pauseTimer(id: string) {
  const run = runOf(id);
  if (run.startedAt === null) return;
  setRun(id, { ...run, laps: [...run.laps], banked: elapsed(run, Date.now()), startedAt: null });
  play("toggleOff", { volume: 0.5 });
}

export const toggleTimer = (id: string) => (isRunning(id) ? pauseTimer(id) : startTimer(id));

export function resetTimer(id: string) {
  if (!project.board.timers?.[id]) return;
  setRun(id, null);
  play("swipe", { volume: 0.5, pitch: 0.9 });
}

/** A stopwatch's lap: the total so far, kept under the time (the latest few). */
export function lapTimer(id: string) {
  const run = runOf(id);
  if (run.startedAt === null || timerData(doc.nodes[id]?.data).mode !== "stopwatch") return;
  setRun(id, { ...run, laps: [...run.laps, elapsed(run, Date.now())].slice(-50) });
  play("tap", { pitch: 1.2 });
}

/** An undoable change to the timer's data; changing what it counts (mode, duration) resets it. */
export function setTimer(id: string, label: string, patch: Partial<TimerData>) {
  const n = doc.nodes[id];
  if (!isTimer(n)) return;
  const d = timerData(n.data);
  const next = { ...d, ...patch };
  if (JSON.stringify(next) === JSON.stringify(d)) return;
  history.run(label, [{ type: "updateNodes", changes: [{ id, props: { data: next } }] }]);
  if (next.mode !== d.mode || next.duration !== d.duration) {
    if (project.board.timers?.[id]) setRun(id, null);
  }
}

export const setMode = (id: string, mode: TimerMode) => setTimer(id, mode === "stopwatch" ? "Stopwatch" : "Countdown", { mode });
export const setDuration = (id: string, ms: number) => setTimer(id, `Timer ${formatTime(ms)}`, { mode: "countdown", duration: ms });

export const PRESETS = [1, 5, 10, 15, 25, 45, 60].map((m) => m * 60_000);

/** Countdown lengths to pick from, and the two modes (context menu and the card's menu). */
export function timerEntries(id: string): MenuEntry[] {
  const d = timerData(doc.nodes[id]?.data);
  return [
    ...PRESETS.map((ms) => ({ label: formatTime(ms).replace(/^(\d+):00$/, "$1 min").replace(/^1:00:00$/, "1 hour"), checked: d.mode === "countdown" && d.duration === ms, run: () => setDuration(id, ms) })),
    { label: "Other…", run: () => (timerUi.editing = { nodeId: id, field: "duration" }) },
    "-",
    { label: "Countdown", checked: d.mode === "countdown", run: () => setMode(id, "countdown") },
    { label: "Stopwatch", checked: d.mode === "stopwatch", run: () => setMode(id, "stopwatch") },
  ];
}

/** A new countdown at `at`, its length ready to type. */
export function createTimer(at: Point) {
  const node: CanvasNode = {
    id: crypto.randomUUID(),
    kind: "timer",
    assetId: null,
    x: snap(at.x - 110),
    y: snap(at.y - 50),
    w: 220,
    h: 120,
    rotation: 0,
    z: doc.maxZ() + 1,
    data: { ...DEFAULT_TIMER },
  };
  history.run("Add timer", [{ type: "addNodes", nodes: [node] }, ...joinOps([node], at)]);
  selectOnly([node.id]);
  markFresh([node.id]);
  timerUi.editing = { nodeId: node.id, field: "duration" };
}

/** The timer to show in the status bar: the soonest countdown, else a running stopwatch. */
export function soonestTimer(): { node: CanvasNode; ms: number; d: TimerData } | null {
  const now = timerUi.now;
  const all = runningTimers().map((node) => {
    const d = timerData(node.data);
    return { node, d, ms: shown(d, runOf(node.id), now) };
  });
  const countdowns = all.filter((t) => t.d.mode === "countdown").sort((a, b) => a.ms - b.ms);
  return countdowns[0] ?? all[0] ?? null;
}
