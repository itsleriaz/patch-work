import { SvelteMap, SvelteSet } from "svelte/reactivity";
import type { CanvasNode, MediaData } from "../doc/types";

/**
 * Playback is session state, like the selection: never saved, never in history. Video and
 * audio components own their media elements and follow these sets.
 */

/** Nodes playing right now. They stay mounted while offscreen, so audio keeps going. */
export const playing = new SvelteSet<string>();
/** Nodes whose sound is off. */
export const muted = new SvelteSet<string>();
/** Where each node was left, so it resumes there after its element unmounts. */
export const positions = new Map<string, number>();
/** Volume per node, 0–1 (1 when not set). */
export const volumes = new SvelteMap<string, number>();
/**
 * The frame a paused video was left at (an image URL), shown instead of its poster once its
 * element unmounts, so the picture stays where it was paused.
 */
export const pausedFrames = new SvelteMap<string, string>();

export const isPlayable = (n: CanvasNode) => n.kind === "video" || n.kind === "audio";

/** Videos loop unless turned off; audio plays once unless turned on. */
export function loops(n: CanvasNode): boolean {
  return ((n.data ?? {}) as MediaData).loop ?? n.kind === "video";
}

export function togglePlaying(id: string) {
  if (playing.has(id)) playing.delete(id);
  else playing.add(id);
}

/** Called when a node's component unmounts: one that left the document stops for good. */
export function forget(id: string) {
  playing.delete(id);
  muted.delete(id);
  positions.delete(id);
  volumes.delete(id);
  pausedFrames.delete(id);
}

/** 83 → "1:23", 4000 → "1:06:40". */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds % 60), m = Math.floor(seconds / 60) % 60, h = Math.floor(seconds / 3600);
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
