// Browser-only fallback for `pnpm dev` outside Tauri: lets the canvas be
// exercised in a normal browser. No LODs, no saving; object URLs for files.

import type { Asset } from "../doc/types";
import type { Backend } from "./types";

const urls = new Map<string, string>();
const posters = new Map<string, string>();

async function assetFromBlob(blob: Blob, name: string, storage: Asset["storage"] = "linked"): Promise<Asset> {
  const id = crypto.randomUUID();
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  const img = new Image();
  img.src = url;
  await img.decode();
  return {
    id,
    hash: id,
    kind: blob.type === "image/gif" ? "gif" : "image",
    storage,
    path: name,
    name,
    width: img.naturalWidth,
    height: img.naturalHeight,
    size: blob.size,
    mtime: Date.now(),
  };
}

/** Generates placeholder images for perf testing: `__pw.demo(300)` in the console. */
export async function demoAssets(count: number): Promise<Asset[]> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const out: Asset[] = [];
  for (let i = 0; i < count; i++) {
    canvas.width = 400 + Math.round(Math.random() * 800);
    canvas.height = 300 + Math.round(Math.random() * 600);
    const hue = Math.round(Math.random() * 360);
    const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    g.addColorStop(0, `hsl(${hue} 70% 60%)`);
    g.addColorStop(1, `hsl(${(hue + 60) % 360} 70% 35%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.font = "bold 72px sans-serif";
    ctx.fillText(`#${i + 1}`, 32, 96);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.85));
    out.push(await assetFromBlob(blob, `demo-${i + 1}.jpg`));
  }
  return out;
}

export const webBackend: Backend = {
  kind: "web",

  assetUrl(asset) {
    return urls.get(asset.id) ?? "";
  },

  posterUrl(asset) {
    return posters.get(asset.hash) ?? "";
  },

  // No decoder in the browser fallback: audio cards show a flat line.
  waveformUrl() {
    return "";
  },

  // Nor for sprites: they show as unreadable.
  spriteMetaUrl() {
    return "";
  },
  spriteSheetUrl() {
    return "";
  },
  onAssetChanged() {},
  onOpenFile() {},

  async savePoster(asset, jpeg) {
    posters.set(asset.hash, URL.createObjectURL(jpeg));
  },

  listenDrops(handlers) {
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      e.preventDefault();
      if (depth++ === 0) handlers.onHover(true);
    };
    const onLeave = () => {
      if (--depth === 0) handlers.onHover(false);
    };
    const onOver = (e: DragEvent) => e.preventDefault();
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      handlers.onHover(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      const assets: Asset[] = [];
      const skipped: string[] = [];
      for (const f of files) {
        if (!f.type.startsWith("image/")) {
          skipped.push(f.name);
          continue;
        }
        try {
          assets.push(await assetFromBlob(f, f.name));
        } catch {
          skipped.push(f.name);
        }
      }
      handlers.onDrop(e.clientX, e.clientY, { assets, skipped });
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  },

  async pickOpenPath() {
    alert("Opening projects requires the desktop app.");
    return null;
  },
  async pickSavePath() {
    alert("Saving projects requires the desktop app.");
    return null;
  },
  async saveProject() {},
  async loadProject() {
    throw new Error("Not supported in the browser");
  },
  async confirm(message) {
    return window.confirm(message);
  },
  setTitle(title) {
    document.title = title;
  },
  openUrl(url) {
    window.open(url, "_blank", "noopener");
  },
  async exportFile(name, ext, bytes) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(bytes);
    a.download = `${name}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return a.download;
  },
  async notify(title, body) {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission === "granted") new Notification(title, { body });
  },
  async exportInto(_dir, fileName, bytes) {
    const dot = fileName.lastIndexOf(".");
    return (await this.exportFile(fileName.slice(0, dot), fileName.slice(dot + 1), bytes)) ?? fileName;
  },
  async exportAssetFile(asset, name, ext) {
    return this.exportFile(name, ext, await (await fetch(this.assetUrl(asset, "full"))).blob());
  },
  async exportAssetInto(asset, _dir, fileName) {
    const dot = fileName.lastIndexOf(".");
    return (await this.exportAssetFile(asset, fileName.slice(0, dot), fileName.slice(dot + 1))) ?? fileName;
  },
  async exportSprite() {
    throw new Error("Exporting sprites requires the desktop app.");
  },
  revealFile() {},
  onCloseRequested() {},

  async importBytes(bytes, name) {
    const ext = bytes.type.split("/")[1] ?? "png";
    return assetFromBlob(bytes, `${name}.${ext}`, "embedded");
  },

  // Best effort: browsers only allow this with a permission prompt, and only for text and PNG.
  async readClipboard(imageName) {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) return { kind: "image", asset: await this.importBytes(await item.getType(type), imageName) };
      }
      const text = await navigator.clipboard.readText();
      return text.trim() ? { kind: "text", text } : { kind: "empty" };
    } catch {
      return { kind: "empty" };
    }
  },

  async copyImage(asset) {
    const blob = await (await fetch(this.assetUrl(asset, "full"))).blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  },

  // Object URLs only exist in this tab, so only assets it already knows can be shown.
  async registerAssets(assets) {
    return assets.map((a) => (urls.has(a.id) ? a : { ...a, missing: true }));
  },

  // Storage modes need real files; in the browser everything already lives in memory.
  async packAssets(assets) {
    return assets.map((a) => ({ ...a, storage: "embedded" as const }));
  },
  async collectAssets() {
    throw new Error("Storage needs the desktop app");
  },
  async unpackAssets() {
    throw new Error("Storage needs the desktop app");
  },
  async relinkAssets(_dir, assets) {
    return assets;
  },
  async cancelRelink() {},
  // Browser mode has no files to protect: no recovery copies.
  async saveRecovery() {},
  async listRecoveries() {
    return [];
  },
  async readRecovery() {
    throw new Error("No recovery copies in browser mode");
  },
  async deleteRecovery() {},

  async cleanBlobs() {
    return { removed: 0, bytes: 0 };
  },
  async filesDir() {
    return "";
  },
  async pickFolder() {
    return null;
  },
  async pickPicture() {
    return null;
  },
};
