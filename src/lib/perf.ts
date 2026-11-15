import { doc } from "./app.svelte";

/**
 * Frame timing for the performance overlay (F3) and tests (`__pw.perf`).
 *
 * Frames are timed with requestAnimationFrame, so this measures main-thread frames: our code,
 * Svelte, style and layout. Work the compositor does alone (e.g. a CSS animation) doesn't show.
 * The loop only runs while something is measuring.
 */
const KEEP_MS = 5000;

export interface FrameSummary {
  /** Frames in the window, per second. */
  fps: number;
  /** Mean, 95th percentile and worst frame time, ms. */
  avg: number;
  p95: number;
  worst: number;
  /** Frames over 33 ms (would miss two vsyncs at 60 Hz). */
  janky: number;
  frames: number;
}

class FrameMeter {
  /** Frame end times and durations (ms), oldest first. */
  times: number[] = [];
  durations: number[] = [];
  #last = 0;
  #raf = 0;
  #users = 0;

  #tick = (now: number) => {
    // A gap over a second means the page was hidden, not a slow frame.
    if (this.#last && now - this.#last < 1000) {
      this.times.push(now);
      this.durations.push(now - this.#last);
      while (this.times.length && this.times[0] < now - KEEP_MS) {
        this.times.shift();
        this.durations.shift();
      }
    }
    this.#last = now;
    this.#raf = requestAnimationFrame(this.#tick);
  };

  /** Starts measuring; call the returned function to stop. */
  acquire(): () => void {
    if (this.#users++ === 0) {
      this.#last = 0;
      this.#raf = requestAnimationFrame(this.#tick);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.#users === 0) cancelAnimationFrame(this.#raf);
    };
  }

  /** Frames that ended within the last `ms`. */
  summary(ms = 1000): FrameSummary {
    const since = performance.now() - ms;
    const d = this.durations.filter((_, i) => this.times[i] >= since);
    if (!d.length) return { fps: 0, avg: 0, p95: 0, worst: 0, janky: 0, frames: 0 };
    const sorted = [...d].sort((a, b) => a - b);
    const round = (v: number) => Math.round(v * 10) / 10;
    return {
      fps: round((d.length * 1000) / ms),
      avg: round(d.reduce((a, b) => a + b, 0) / d.length),
      p95: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]),
      worst: round(sorted[sorted.length - 1]),
      janky: d.filter((v) => v > 33).length,
      frames: d.length,
    };
  }
}

export const meter = new FrameMeter();

/** Measures frames for `ms` while `during` (optional) runs, e.g. a scripted pan. */
export async function measure(ms = 2000, during?: () => unknown): Promise<FrameSummary> {
  const release = meter.acquire();
  try {
    await Promise.all([during?.(), new Promise((r) => setTimeout(r, ms))]);
    return meter.summary(ms);
  } finally {
    release();
  }
}

export interface SceneStats {
  nodes: number;
  /** Nodes in the DOM after virtualization. */
  mounted: number;
  /** Mounted images by the level they show: LOD size, "full", or "other" (e.g. browser mode). */
  levels: Record<string, number>;
  /** Rough decoded size of mounted images, MB (width × height × 4). */
  decodedMB: number;
}

/** Reads the DOM, so call it a few times a second at most. */
export function sceneStats(): SceneStats {
  const levels: Record<string, number> = {};
  let bytes = 0;
  for (const img of document.querySelectorAll<HTMLImageElement>(".node img")) {
    const level = img.src.match(/\/lod\/[^/]+\/(\d+)/)?.[1] ?? (img.src.includes("/file/") ? "full" : "other");
    levels[level] = (levels[level] ?? 0) + 1;
    bytes += img.naturalWidth * img.naturalHeight * 4;
  }
  return {
    nodes: doc.nodeList.length,
    mounted: document.querySelectorAll(".node").length,
    levels,
    decodedMB: Math.round(bytes / 1e5) / 10,
  };
}
