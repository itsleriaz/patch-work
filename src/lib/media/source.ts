import { backend } from "../backend";
import type { Asset } from "../doc/types";
import { isMac, isWindows } from "../platform";

/**
 * Where a <video> or <audio> element loads a file from.
 *
 * Normally the app's loopback media server (see `media_server.rs`). But WebKitGTK (Linux) can't
 * seek in a video it has already downloaded completely over HTTP: playback stalls a moment after
 * the seek point (seen with WebKitGTK 2.52 and GStreamer 1.28, with any HTTP server). Small videos
 * always download completely at once, so on Linux they play from an in-memory blob instead,
 * which seeks fine. Large videos stream: their downloads are still running when people seek.
 *
 * Audio always streams: it seeks fine over HTTP, and some files break as blobs (24-bit FLAC:
 * GStreamer's flacparse fails with "gst_base_parse_finish_frame: assertion 'size > 0'").
 */
const BLOB_MAX = 64 << 20;
/** A blob outlives its last user briefly, so hovering on and off a video doesn't refetch it. */
const KEEP_MS = 15_000;

const useBlobs = backend.kind === "tauri" && !isMac && !isWindows;

interface Entry {
  url: Promise<string>;
  users: number;
  timer?: ReturnType<typeof setTimeout>;
}
const blobs = new Map<string, Entry>();

export interface MediaUrl {
  url: Promise<string>;
  release(): void;
}

/** A URL to play `asset` from; call `release` when the element is gone. */
export function acquireMediaUrl(asset: Asset): MediaUrl {
  const direct = backend.assetUrl(asset, "full");
  if (!useBlobs || asset.kind !== "video" || asset.size > BLOB_MAX) return { url: Promise.resolve(direct), release() {} };

  let entry = blobs.get(asset.hash);
  if (!entry) {
    const url = fetch(direct)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${r.status}`))))
      .then((blob) => URL.createObjectURL(blob));
    entry = { url, users: 0 };
    blobs.set(asset.hash, entry);
    // A failed fetch isn't cached: the next attempt tries again.
    url.catch(() => blobs.delete(asset.hash));
  }
  const e = entry;
  e.users++;
  clearTimeout(e.timer);
  let released = false;
  return {
    url: e.url,
    release() {
      if (released) return;
      released = true;
      if (--e.users > 0) return;
      e.timer = setTimeout(() => {
        if (e.users > 0 || blobs.get(asset.hash) !== e) return;
        blobs.delete(asset.hash);
        void e.url.then((u) => URL.revokeObjectURL(u), () => {});
      }, KEEP_MS);
    },
  };
}
