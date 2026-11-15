import type { Asset, ImportResult, Pasted, ProjectDoc } from "../doc/types";

/** A downscaled level (longest side in px), or the original file. */
export type Level = number | "full";

export interface DropHandlers {
  onHover(over: boolean): void;
  /** Client (CSS px) coordinates of the drop point. */
  onDrop(clientX: number, clientY: number, result: ImportResult): void;
  /** A board file was dropped (desktop only): open it instead of importing. */
  onOpen?(path: string): void;
  onError(message: string): void;
}

/** How a search for missing files is going. */
export interface RelinkProgress {
  /** Files looked at so far. */
  scanned: number;
  /** Missing files found so far, of `missing`. */
  found: number;
  missing: number;
  /** The folder being looked through. */
  folder: string;
}

/** A recovery copy of a board's unsaved state (written by autosave, offered after a crash). */
export interface RecoveryMeta {
  /** "path:<file>" or "untitled:<id>". */
  key: string;
  path: string | null;
  name: string;
  /** When it was written, ms since the epoch. */
  time: number;
}

/** What `export_sprite` makes (see `sprite.rs`). */
export interface SpriteExportRequest {
  kind: "png" | "sheet" | "gif";
  /** "file" or one 0/1 per layer index (`maskOf`). */
  mask: string;
  /** Frame indices in playing order. */
  frames: number[];
  /** Whole-number pixel scale. */
  scale: number;
  /** "#rrggbb" behind the frames; null: transparent. */
  background: string | null;
}

export interface Backend {
  readonly kind: "tauri" | "web";
  assetUrl(asset: Asset, level: Level): string;
  /** A video's poster frame (404 until one has been saved). */
  posterUrl(asset: Asset): string;
  /** An audio file's waveform: JSON `{ duration, peaks }`. */
  waveformUrl(asset: Asset): string;
  /** An Aseprite file's description (`SpriteMeta`). */
  spriteMetaUrl(asset: Asset): string;
  /** Its frames in a grid: `mask` is "file" or one 0/1 per layer index (see `maskOf`). */
  spriteSheetUrl(asset: Asset, mask: string): string;
  /** A linked file changed on disk (sprites are watched): the asset with its new hash. */
  onAssetChanged(handler: (asset: Asset) => void): void;
  /** The OS asked to open a board file (double-click, "Open with"); also called for one waiting since launch. */
  onOpenFile(handler: (path: string) => void): void;
  /** Stores a video's poster frame (JPEG) for its content hash. */
  savePoster(asset: Asset, jpeg: Blob): Promise<void>;
  listenDrops(handlers: DropHandlers): () => void;
  pickOpenPath(): Promise<string | null>;
  pickSavePath(current: string | null): Promise<string | null>;
  saveProject(path: string, doc: ProjectDoc): Promise<void>;
  loadProject(path: string): Promise<ProjectDoc>;
  /** Recovery copies (autosave): one per board, replaced on every write. */
  saveRecovery(meta: RecoveryMeta, doc: ProjectDoc): Promise<void>;
  listRecoveries(): Promise<RecoveryMeta[]>;
  readRecovery(key: string): Promise<ProjectDoc>;
  deleteRecovery(key: string): Promise<void>;
  confirm(message: string, title: string): Promise<boolean>;
  setTitle(title: string): void;
  openUrl(url: string): void;
  /** Shows the file in Explorer / Finder. */
  revealFile(path: string): void;
  /** Handler returns true to allow the window to close. */
  onCloseRequested(handler: () => Promise<boolean>): void;
  /**
   * Saves an exported file: asks where (suggesting `name` plus `.ext`), then writes it. Returns
   * the path written, or null when cancelled. The browser fallback downloads it.
   */
  exportFile(name: string, ext: string, bytes: Blob): Promise<string | null>;
  /** A system notification (asks for permission the first time). */
  notify(title: string, body: string): Promise<void>;
  /** Writes an exported file into `dir` as `fileName`, or "name (2).ext"… when taken. Returns the path. */
  exportInto(dir: string, fileName: string, bytes: Blob): Promise<string>;
  /** An asset's own file, copied as it is (by Rust, never through memory) to a path picked in a save dialog; null when cancelled. */
  exportAssetFile(asset: Asset, name: string, ext: string): Promise<string | null>;
  /** The same into `dir` as `fileName`, or "name (2).ext"… when taken. Returns the path. */
  exportAssetInto(asset: Asset, dir: string, fileName: string): Promise<string>;
  /** A sprite exported by Rust: a frame or a sheet as PNG, or an animated GIF. */
  exportSprite(asset: Asset, request: SpriteExportRequest): Promise<Blob>;
  /** Image bytes become an embedded asset; `name` gets the extension appended. */
  importBytes(bytes: Blob, name: string): Promise<Asset>;
  /** Reads the system clipboard; a pasted image is imported as `imageName`. */
  readClipboard(imageName: string): Promise<Pasted>;
  /** Puts the asset's image on the system clipboard for other apps. */
  copyImage(asset: Asset): Promise<void>;
  /** Re-checks assets arriving from elsewhere (pasted nodes) and makes them displayable. */
  registerAssets(assets: Asset[]): Promise<Asset[]>;

  // Storage operations take the board's assets and return them updated (same ids).
  /** Embeds every linked image. */
  packAssets(assets: Asset[]): Promise<Asset[]>;
  /** Copies linked images into the folder next to the board. */
  collectAssets(project: string, assets: Asset[]): Promise<Asset[]>;
  /** Writes embedded images into the folder next to the board and links them. */
  unpackAssets(project: string, assets: Asset[]): Promise<Asset[]>;
  /**
   * Looks for missing files inside `dir`, at most `maxDepth` folders down (null: no limit),
   * reporting how it goes about ten times a second. `cancelRelink` stops it, keeping what it found.
   */
  relinkAssets(dir: string, assets: Asset[], maxDepth: number | null, onProgress: (p: RelinkProgress) => void): Promise<Asset[]>;
  cancelRelink(): Promise<void>;
  /** Deletes blobs unused for 30 days, except these hashes (what the open board may still need). */
  cleanBlobs(keep: string[]): Promise<{ removed: number; bytes: number }>;
  /** The folder collect and unpack write to. */
  filesDir(project: string): Promise<string>;
  pickFolder(title: string): Promise<string | null>;
  /** Asks for one picture file and imports it (Replace picture); null when cancelled. */
  pickPicture(title: string): Promise<ImportResult | null>;
}
