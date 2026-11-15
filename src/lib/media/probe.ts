import { backend } from "../backend";
import type { Asset } from "../doc/types";
import { acquireMediaUrl } from "./source";

/**
 * Video and audio are probed by the webview, not by Rust: it decodes every format it can play
 * (and only those), so a file that probes fine will play. A video's probe also captures its
 * poster frame, which idle video nodes show as a plain image.
 */

export interface Probe {
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
}

/** Longest side of a stored poster. */
const POSTER_MAX = 1280;
const TIMEOUT_MS = 20_000;
/** Media elements probing at once: each one can start a decoder pipeline. */
const PARALLEL = 3;

let running = 0;
const waiting: (() => void)[] = [];

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running >= PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** Resolves on `event`, rejects on an error or after the timeout. */
function once(el: HTMLMediaElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error("timed out")), TIMEOUT_MS);
    const ok = () => done();
    const fail = () => done(new Error(el.error?.message || "can't play"));
    function done(error?: Error) {
      clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener("error", fail);
      if (error) reject(error);
      else resolve();
    }
    el.addEventListener(event, ok);
    el.addEventListener("error", fail);
  });
}

function release(el: HTMLMediaElement) {
  el.removeAttribute("src");
  el.load(); // frees the decoder now rather than at garbage collection
}

/** A frame a little way in (the first is often black), downscaled and saved as the poster. */
async function capturePoster(video: HTMLVideoElement, asset: Asset) {
  const d = video.duration;
  const at = Number.isFinite(d) && d > 2 ? Math.min(d * 0.1, 3) : 0;
  if (at > 0) {
    video.currentTime = at;
    await once(video, "seeked");
  }
  const scale = Math.min(1, POSTER_MAX / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (jpeg) await backend.savePoster(asset, jpeg);
}

function loadVideo(src: string): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  // The media server allows any origin, so the canvas the poster is drawn on stays readable.
  video.crossOrigin = "anonymous";
  video.src = src;
  return video;
}

/** Size and duration of a video, with its poster saved; null when the webview can't play it. */
export function probeVideo(asset: Asset): Promise<Probe | null> {
  return limited(async () => {
    const media = acquireMediaUrl(asset);
    let video: HTMLVideoElement | undefined;
    try {
      video = loadVideo(await media.url);
      await once(video, "loadeddata");
      const probe = { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
      if (!probe.width || !probe.height) return null;
      await capturePoster(video, asset).catch((e) => console.warn(`No poster for ${asset.name}:`, e));
      return probe;
    } catch {
      return null;
    } finally {
      if (video) release(video);
      media.release();
    }
  });
}

/** Duration of an audio file; null when the webview can't play it. */
export function probeAudio(asset: Asset): Promise<Probe | null> {
  return limited(async () => {
    const media = acquireMediaUrl(asset);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    try {
      audio.src = await media.url;
      await once(audio, "loadedmetadata");
      return { width: 0, height: 0, duration: audio.duration };
    } catch {
      return null;
    } finally {
      release(audio);
      media.release();
    }
  });
}

const capturing = new Map<string, Promise<boolean>>();

/**
 * Captures a poster that isn't cached on this machine (a board from elsewhere, a cleared
 * cache). Resolves true once it's saved; concurrent calls for the same video share the work.
 */
export function ensurePoster(asset: Asset): Promise<boolean> {
  let job = capturing.get(asset.hash);
  if (!job) {
    job = probeVideo(asset).then((p) => p !== null);
    capturing.set(asset.hash, job);
    void job.then((ok) => {
      if (!ok) capturing.delete(asset.hash); // let a later attempt retry
    });
  }
  return job;
}
