import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type { Asset, ImportResult, Pasted, ProjectDoc } from "../doc/types";
import type { Backend, RecoveryMeta, RelinkProgress } from "./types";

// "pw://localhost/" on macOS/Linux, "http://pw.localhost/" on Windows.
// Resolved lazily: this module is also imported when running in a plain browser.
let base: string | undefined;
/** The loopback media server, set by an init script (see `media_server.rs`). */
const mediaBase = (window as { __PATCHWORK_MEDIA__?: string }).__PATCHWORK_MEDIA__;
const filters = [{ name: "Patchwork board", extensions: ["patchwork"] }];

export const tauriBackend: Backend = {
  kind: "tauri",

  assetUrl(asset, level) {
    // The hash only busts caches when a linked file changes; the server ignores it.
    base ??= convertFileSrc("", "pw");
    const v = `?v=${asset.hash.slice(0, 16)}`;
    // WebKitGTK can't play media from custom schemes, so video and audio stream over HTTP.
    if (mediaBase && (asset.kind === "video" || asset.kind === "audio")) return `${mediaBase}file/${asset.id}${v}`;
    return level === "full" ? `${base}file/${asset.id}${v}` : `${base}lod/${asset.id}/${level}${v}`;
  },

  posterUrl(asset) {
    base ??= convertFileSrc("", "pw");
    return `${base}poster/${asset.id}?v=${asset.hash.slice(0, 16)}`;
  },

  waveformUrl(asset) {
    base ??= convertFileSrc("", "pw");
    return `${base}wave/${asset.id}?v=${asset.hash.slice(0, 16)}`;
  },

  spriteMetaUrl(asset) {
    base ??= convertFileSrc("", "pw");
    return `${base}sprite/${asset.id}/meta?v=${asset.hash.slice(0, 16)}`;
  },

  spriteSheetUrl(asset, mask) {
    base ??= convertFileSrc("", "pw");
    return `${base}sprite/${asset.id}/sheet/${mask}?v=${asset.hash.slice(0, 16)}`;
  },

  onAssetChanged(handler) {
    void listen<Asset>("asset-changed", (e) => handler(e.payload));
  },

  onOpenFile(handler) {
    // The path waits in the core until taken, so a file that arrived before this ran isn't lost.
    const take = () => void invoke<string | null>("take_open_file").then((p) => p && handler(p));
    void listen("open-file", take);
    take();
  },

  async savePoster(asset, jpeg) {
    const body = new Uint8Array(await jpeg.arrayBuffer());
    await invoke("save_poster", body, { headers: { "x-hash": asset.hash } });
  },

  listenDrops(handlers) {
    const unlisten = getCurrentWebview().onDragDropEvent(async ({ payload }) => {
      if (payload.type === "enter" || payload.type === "over") return handlers.onHover(true);
      if (payload.type === "leave") return handlers.onHover(false);
      handlers.onHover(false);
      const pos = payload.position.toLogical(window.devicePixelRatio);
      const board = payload.paths.find((p) => /\.patchwork$/i.test(p));
      if (board && handlers.onOpen) return handlers.onOpen(board);
      try {
        const result = await invoke<ImportResult>("import_files", { paths: payload.paths });
        handlers.onDrop(pos.x, pos.y, result);
      } catch (e) {
        handlers.onError(String(e));
      }
    });
    return () => void unlisten.then((fn) => fn());
  },

  async pickOpenPath() {
    const path = await open({ multiple: false, directory: false, filters });
    return typeof path === "string" ? path : null;
  },

  pickSavePath(current) {
    return save({ filters, defaultPath: current ?? "Untitled.patchwork" });
  },

  saveProject(path, doc) {
    return invoke("save_project", { path, doc });
  },

  loadProject(path) {
    return invoke<ProjectDoc>("load_project", { path });
  },

  confirm(message, title) {
    return ask(message, { title, kind: "warning" });
  },

  setTitle(title) {
    void getCurrentWindow().setTitle(title);
  },

  openUrl(url) {
    void openUrl(url);
  },

  async exportFile(name, ext, bytes) {
    const path = await save({ defaultPath: `${name}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return null;
    await invoke("write_export", new Uint8Array(await bytes.arrayBuffer()), { headers: { "x-path": encodeURIComponent(path) } });
    return path;
  },

  async notify(title, body) {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  },

  async exportInto(dir, fileName, bytes) {
    const headers = { "x-dir": encodeURIComponent(dir), "x-name": encodeURIComponent(fileName) };
    return invoke<string>("write_export_new", new Uint8Array(await bytes.arrayBuffer()), { headers });
  },

  async exportAssetFile(asset, name, ext) {
    const path = await save({ defaultPath: `${name}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return null;
    return invoke<string>("copy_export", { id: asset.id, path });
  },

  exportAssetInto(asset, dir, fileName) {
    return invoke<string>("copy_export", { id: asset.id, dir, name: fileName });
  },

  async exportSprite(asset, request) {
    const bytes = await invoke<ArrayBuffer>("export_sprite", { id: asset.id, request });
    return new Blob([bytes], { type: request.kind === "gif" ? "image/gif" : "image/png" });
  },

  revealFile(path) {
    void revealItemInDir(path);
  },

  onCloseRequested(handler) {
    void getCurrentWindow().onCloseRequested(async (event) => {
      if (!(await handler())) event.preventDefault();
    });
  },

  async importBytes(bytes, name) {
    // A raw body skips JSON-encoding megabytes of image data.
    const body = new Uint8Array(await bytes.arrayBuffer());
    return invoke<Asset>("import_bytes", body, { headers: { "x-name": encodeURIComponent(name) } });
  },

  readClipboard(imageName) {
    return invoke<Pasted>("read_clipboard", { imageName });
  },

  copyImage(asset) {
    return invoke("copy_image", { assetId: asset.id });
  },

  registerAssets(assets) {
    return invoke<Asset[]>("register_assets", { assets });
  },

  packAssets(assets) {
    return invoke<Asset[]>("pack_assets", { assets });
  },

  collectAssets(project, assets) {
    return invoke<Asset[]>("collect_assets", { project, assets });
  },

  unpackAssets(project, assets) {
    return invoke<Asset[]>("unpack_assets", { project, assets });
  },

  relinkAssets(dir, assets, maxDepth, onProgress) {
    const channel = new Channel<RelinkProgress>();
    channel.onmessage = onProgress;
    return invoke<Asset[]>("relink_assets", { dir, assets, maxDepth, onProgress: channel });
  },

  cancelRelink() {
    return invoke<void>("cancel_relink");
  },

  saveRecovery(meta, doc) {
    return invoke("save_recovery", { meta, doc });
  },

  listRecoveries() {
    return invoke<RecoveryMeta[]>("list_recoveries");
  },

  readRecovery(key) {
    return invoke<ProjectDoc>("read_recovery", { key });
  },

  deleteRecovery(key) {
    return invoke("delete_recovery", { key });
  },

  cleanBlobs(keep) {
    return invoke<{ removed: number; bytes: number }>("clean_blobs", { keep });
  },

  filesDir(project) {
    return invoke<string>("files_dir", { project });
  },

  async pickFolder(title) {
    const dir = await open({ directory: true, multiple: false, title });
    return typeof dir === "string" ? dir : null;
  },

  async pickPicture(title) {
    const path = await open({ multiple: false, directory: false, title, filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }] });
    return typeof path === "string" ? invoke<ImportResult>("import_files", { paths: [path] }) : null;
  },
};
