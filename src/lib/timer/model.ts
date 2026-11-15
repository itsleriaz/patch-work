import type { CanvasNode } from "../doc/types";

/**
 * A timer: a stopwatch or a countdown. The node's `data` holds what's edited (and undoable): its
 * label, mode, duration and size. Whether it runs lives apart, in the board (`TimerRun`, in
 * `project.board.timers` by node id), so undo never stops or rewinds a timer, and copies start
 * fresh. A run stores when it started, not a tally: the time is worked out from the clock, so it
 * stays right through sleep and while the app is closed.
 */
export type TimerMode = "stopwatch" | "countdown";

export type TimerData = {
  label: string;
  mode: TimerMode;
  /** A countdown's length, ms. */
  duration: number;
  /** World units; the card scales with it, like a counter. */
  fontSize: number;
};

export const DEFAULT_TIMER: TimerData = { label: "", mode: "countdown", duration: 5 * 60_000, fontSize: 18 };

export function timerData(data: unknown): TimerData {
  const d = { ...DEFAULT_TIMER, ...(data as Partial<TimerData> | null) };
  const duration = Number.isFinite(d.duration) && d.duration > 0 ? Math.round(d.duration) : DEFAULT_TIMER.duration;
  return { ...d, mode: d.mode === "stopwatch" ? "stopwatch" : "countdown", duration };
}

export const isTimer = (n: CanvasNode | undefined) => n?.kind === "timer";

/** A timer's run: absent or empty means reset. */
export type TimerRun = {
  /** When it was last started (ms since the epoch); null while paused. */
  startedAt: number | null;
  /** Time run before that start, ms. */
  banked: number;
  /** A stopwatch's laps: the total time at each, ms. */
  laps: number[];
  /** A countdown that reached zero (it stays at 0 until reset). */
  done?: boolean;
};

export const IDLE: TimerRun = { startedAt: null, banked: 0, laps: [] };

/** Time run so far, ms. */
export const elapsed = (run: TimerRun, now: number) => run.banked + (run.startedAt === null ? 0 : Math.max(0, now - run.startedAt));

/** What the card shows, ms: time run (stopwatch) or time left (countdown, never below 0). */
export function shown(d: TimerData, run: TimerRun, now: number): number {
  if (d.mode === "stopwatch") return elapsed(run, now);
  return run.done ? 0 : Math.max(0, d.duration - elapsed(run, now));
}

/** "4:05", "1:02:03"; with `tenths`, "4:05.3". Countdowns round up, so 0:00 means done. */
export function formatTime(ms: number, { tenths = false, up = false } = {}): string {
  const total = up ? Math.ceil(ms / 1000) * 1000 : ms;
  const h = Math.floor(total / 3_600_000), m = Math.floor((total % 3_600_000) / 60_000), s = Math.floor((total % 60_000) / 1000);
  const ss = String(s).padStart(2, "0");
  const base = h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  return tenths ? `${base}.${Math.floor((total % 1000) / 100)}` : base;
}

/**
 * A typed duration in ms, or null: "25" (minutes), "1:30" (m:ss), "1:02:03", "90s", "1h30m",
 * "2h", "45 min", "1.5h". At most 24 hours.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  let ms: number | null = null;
  if (/^\d+(\.\d+)?$/.test(t)) ms = parseFloat(t) * 60_000;
  else if (/^\d+(:\d{1,2}){1,2}$/.test(t)) {
    const parts = t.split(":").map(Number);
    if (parts.slice(1).some((p) => p >= 60)) return null;
    ms = parts.reduce((acc, p) => acc * 60 + p, 0) * 1000;
  } else {
    const units: Record<string, number> = { h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000, m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000, s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000 };
    const re = /(\d+(?:\.\d+)?)([a-z]+)/g;
    let sum = 0, used = 0;
    for (const [whole, num, unit] of t.matchAll(re)) {
      if (!(unit in units)) return null;
      sum += parseFloat(num) * units[unit];
      used += whole.length;
    }
    if (used !== t.length) return null;
    ms = sum;
  }
  if (ms === null || !Number.isFinite(ms) || ms < 1000 || ms > 24 * 3_600_000) return null;
  return Math.round(ms / 1000) * 1000;
}

/** "Tea: 4:05 left", "Run: 12:31.4" (for other apps). */
export function timerText(d: TimerData, run: TimerRun, now: number): string {
  const name = d.label.trim() || (d.mode === "stopwatch" ? "Stopwatch" : "Timer");
  const t = shown(d, run, now);
  if (d.mode === "stopwatch") return `${name}: ${formatTime(t, { tenths: true })}`;
  return run.done ? `${name}: done` : `${name}: ${formatTime(t, { up: true })} left`;
}
