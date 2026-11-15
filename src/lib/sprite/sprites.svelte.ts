import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { camera, doc, history, ui } from "../app.svelte";
import { backend } from "../backend";
import type { Asset, CanvasNode } from "../doc/types";
import { play } from "../juice/sound";
import type { MenuEntry } from "../ui/Menu.svelte";
import { isSprite, layerShown, sequence, spriteData, tagOf, type SpriteData, type SpriteMeta } from "./model";

/**
 * Sprites at run time: their descriptions (fetched once per content hash), playback (session
 * state, like video: which play, and where each one is), and the commands that change a sprite's
 * tag and layers (undoable). One animation-frame loop advances every playing sprite by its frames'
 * own durations.
 */

/** Descriptions by content hash; "failed" when the file couldn't be read. */
const metas = new SvelteMap<string, SpriteMeta | "failed">();
const loading = new Set<string>();

/** The asset's description: null while it loads (fetching it the first time). */
export function spriteMeta(asset: Asset): SpriteMeta | "failed" | null {
  const hit = metas.get(asset.hash);
  if (hit) return hit;
  if (!loading.has(asset.hash)) {
    loading.add(asset.hash);
    fetch(backend.spriteMetaUrl(asset))
      .then((r) => (r.ok ? (r.json() as Promise<SpriteMeta>) : Promise.reject(new Error(String(r.status)))))
      .then((m) => metas.set(asset.hash, m), () => metas.set(asset.hash, "failed"))
      .finally(() => loading.delete(asset.hash));
  }
  return null;
}

const metaOf = (n: CanvasNode) => {
  const a = doc.assetOf(n);
  const m = a ? metas.get(a.hash) : undefined;
  return m && m !== "failed" ? m : undefined;
};

class SpriteUi {
  /** Sprites playing (session state). */
  playing = new SvelteSet<string>();
  /** Where each sprite is in its sequence (the tag's frames in order): a step, not a frame index. */
  steps = new SvelteMap<string, number>();
  /** The sprite whose bar opened the tag or layers menu. */
  menu = $state<{ nodeId: string; what: "tags" | "layers" } | null>(null);
}
export const spriteUi = new SpriteUi();

/** The node's current frame index (in the file). */
export function currentFrame(n: CanvasNode, meta: SpriteMeta): number {
  const seq = sequence(meta, tagOf(meta, spriteData(n.data)));
  return seq.length ? seq[(spriteUi.steps.get(n.id) ?? 0) % seq.length] : 0;
}

// ---------------------------------------------------------------- playback

/** Time into each playing sprite's current frame (ms). */
const into = new Map<string, number>();
let last: number | null = null;
let raf = 0;

function tick(now: number) {
  const dt = last === null ? 0 : Math.min(now - last, 250);
  last = now;
  for (const id of spriteUi.playing.values()) {
    const n = doc.nodes[id];
    const meta = n && metaOf(n);
    if (!n || !isSprite(n)) {
      spriteUi.playing.delete(id);
      continue;
    }
    if (!meta) continue;
    const seq = sequence(meta, tagOf(meta, spriteData(n.data)));
    if (!seq.length) continue;
    let step = (spriteUi.steps.get(id) ?? 0) % seq.length;
    let t = (into.get(id) ?? 0) + dt;
    // Frames may be shorter than an animation frame: skip as many as the time covers.
    for (let guard = 0; t >= (meta.frames[seq[step]] || 100) && guard < seq.length; guard++) {
      t -= meta.frames[seq[step]] || 100;
      step = (step + 1) % seq.length;
    }
    into.set(id, t);
    if (step !== spriteUi.steps.get(id)) spriteUi.steps.set(id, step);
  }
  raf = spriteUi.playing.size ? requestAnimationFrame(tick) : 0;
  if (!raf) last = null;
}

export function toggleSprite(id: string) {
  if (spriteUi.playing.has(id)) spriteUi.playing.delete(id);
  else {
    spriteUi.playing.add(id);
    into.delete(id);
    if (!raf) raf = requestAnimationFrame(tick);
  }
}

/** Pauses and moves one frame along the sequence (wrapping). */
export function stepSprite(id: string, by: number) {
  const n = doc.nodes[id];
  const meta = n && metaOf(n);
  if (!meta) return;
  spriteUi.playing.delete(id);
  const len = sequence(meta, tagOf(meta, spriteData(n.data))).length || 1;
  spriteUi.steps.set(id, (((spriteUi.steps.get(id) ?? 0) + by) % len + len) % len);
  into.delete(id);
}

/** Jumps to a step of the sequence (scrubbing). */
export function seekSprite(id: string, step: number) {
  spriteUi.steps.set(id, Math.max(0, step));
  into.delete(id);
}

// ---------------------------------------------------------------- commands

function setData(n: CanvasNode, label: string, patch: Partial<SpriteData>) {
  history.run(label, [{ type: "updateNodes", changes: [{ id: n.id, props: { data: { ...spriteData(n.data), ...patch } } }] }]);
}

/** Plays a tag (null: every frame), from its start. */
export function setTag(id: string, tag: string | null) {
  const n = doc.nodes[id];
  if (!n || spriteData(n.data).tag === tag) return;
  setData(n, tag ? `Play "${tag}"` : "Play all frames", { tag });
  spriteUi.steps.set(id, 0);
  into.delete(id);
  play("tap", { pitch: 1.15 });
}

/** Shows or hides a layer. Back to the file's own visibility, the override is dropped. */
export function toggleLayer(id: string, name: string) {
  const n = doc.nodes[id];
  const meta = n && metaOf(n);
  const layer = meta?.layers.find((l) => l.name === name);
  if (!n || !layer) return;
  const d = spriteData(n.data);
  const show = !layerShown(d, layer);
  const layers = { ...d.layers };
  if (show === layer.visible) delete layers[name];
  else layers[name] = show;
  setData(n, show ? `Show layer "${name}"` : `Hide layer "${name}"`, { layers });
  play(show ? "toggleOn" : "toggleOff", { volume: 0.5 });
}

/** The tag picker's entries (the bar's menu, and the context menu's "Animation"). */
export function tagEntries(id: string): MenuEntry[] {
  const n = doc.nodes[id];
  const meta = n && metaOf(n);
  if (!meta) return [];
  const current = tagOf(meta, spriteData(n.data))?.name ?? null;
  const frames = (k: number) => (k === 1 ? "1 frame" : `${k} frames`);
  return [
    { label: "All frames", hint: frames(meta.frames.length), checked: current === null, run: () => setTag(id, null) },
    ...(meta.tags.length ? (["-"] as MenuEntry[]) : []),
    ...meta.tags.map((t) => ({ label: t.name, hint: frames(t.to - t.from + 1), checked: current === t.name, run: () => setTag(id, t.name) })),
  ];
}

/** The layer toggles, top layer first like Aseprite's list. */
export function layerEntries(id: string): MenuEntry[] {
  const n = doc.nodes[id];
  const meta = n && metaOf(n);
  if (!meta) return [];
  const d = spriteData(n.data);
  return [...meta.layers].reverse().map((l) => ({
    label: l.name,
    hint: l.blend !== "normal" ? l.blend : undefined,
    checked: layerShown(d, l),
    run: () => toggleLayer(id, l.name),
  }));
}

/** Opens the bar's tag or layers menu under the pointer. */
export function openSpriteMenu(e: MouseEvent, nodeId: string, what: "tags" | "layers") {
  e.stopPropagation();
  spriteUi.menu = { nodeId, what };
  const v = document.querySelector(".viewport")?.getBoundingClientRect();
  ui.menu = { x: e.clientX, y: e.clientY, world: camera.toWorld(e.clientX - (v?.left ?? 0), e.clientY - (v?.top ?? 0)), target: "sprite" };
}

export function spriteMenu(): MenuEntry[] {
  const m = spriteUi.menu;
  if (!m) return [];
  return m.what === "tags" ? tagEntries(m.nodeId) : layerEntries(m.nodeId);
}
