import type { TimerRun } from "../timer/model";

export type AssetKind = "image" | "gif" | "video" | "audio" | "pdf" | "sprite";

export interface Asset {
  /** Stable identity; the content hash at import time. */
  id: string;
  /** Current content hash. Changes when a linked file changes on disk. */
  hash: string;
  kind: AssetKind;
  /** Linked: a file on disk at `path`. Embedded: bytes saved inside the project file (e.g. pasted
   *  images); `path` is where this machine keeps them while the app runs. */
  storage: "linked" | "embedded";
  path: string;
  name: string;
  width: number;
  height: number;
  size: number;
  mtime: number;
  missing?: boolean;
  /** Embedded: where unpacking puts the file inside the board's files folder (kept from packing). */
  rel?: string | null;
}

export type NodeKind = "image" | "gif" | "video" | "audio" | "pdf" | "sprite" | "timer" | "drawing" | "palette" | "map" | "text" | "checklist" | "counter" | "frame" | "pin" | "table";

export type TextAlign = "left" | "center" | "right";
export type TextColor = "none" | "paper" | "yellow" | "green" | "blue" | "pink" | "ink";

/** `data` of a text node. Height is derived from the rendered content. */
export interface TextData {
  md: string;
  /** World units; scales with the node. */
  fontSize: number;
  align: TextAlign;
  color: TextColor;
  /** The card keeps its height (`node.h`) instead of following its content; overflow scrolls. */
  fixed?: boolean;
}

/** `data` of image and gif nodes. */
/** `data` of image, gif, video and audio nodes. Flips don't apply to audio. */
export interface MediaData {
  flipX?: boolean;
  flipY?: boolean;
  /** Video and audio: start over at the end. Videos loop unless this is false; audio doesn't. */
  loop?: boolean;
  /** Images and GIFs: the box keeps its shape and the picture fits inside it or fills it (cropped). */
  slot?: "fit" | "fill";
  /** With a fill slot: which part of the picture stays in view, 0..1 on each axis (default 0.5). */
  focus?: { x: number; y: number };
}

export interface CanvasNode {
  id: string;
  kind: NodeKind;
  assetId: string | null;
  /** Top-left corner in world units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees. */
  rotation: number;
  /** Stacking order; higher is on top. */
  z: number;
  data?: Record<string, unknown> | null;
  /** Locked: can't be moved, resized, rotated or deleted (its content stays editable). */
  locked?: boolean;
  /**
   * The node this one is attached to: it follows that node's moves, scaling and turns. A parent
   * that no longer exists counts as none (read it through `parentOf`).
   */
  parent?: string;
}

export type LinkArrow = "none" | "end" | "both";
export type LinkShape = "curve" | "straight" | "elbow";
export type LinkColor = "default" | "red" | "orange" | "yellow" | "green" | "blue" | "purple";

/** `data` of a link. Read it through `linkData()`, which fills in defaults. */
export interface LinkData {
  /** Links saved before shapes existed have none and stay curves. */
  shape: LinkShape;
  arrow: LinkArrow;
  color: LinkColor;
  dashed: boolean;
  label: string;
  /** A side pinned by hand, in the node's own frame. Absent or null: the side facing the other end. */
  fromSide?: LinkSide | null;
  toSide?: LinkSide | null;
}

export type LinkSide = "top" | "right" | "bottom" | "left";

/** A connection between two nodes. Anchors are derived from the nodes' geometry. */
export interface CanvasLink {
  id: string;
  from: string;
  to: string;
  data?: Partial<LinkData> | null;
}

/** Screen = world * zoom + (x, y). */
export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

/** Settings that belong to one board, saved in its file. */
export interface BoardSettings {
  /** Newly added images are embedded in the board instead of linked. */
  embedNew: boolean;
  /** Timers' running state by node id (out of undo; see timer/model.ts). */
  timers?: Record<string, TimerRun>;
}

export interface ProjectDoc {
  camera: CameraState;
  assets: Asset[];
  nodes: CanvasNode[];
  /** Absent in files from before links existed. */
  links?: CanvasLink[];
  board?: BoardSettings;
}

export interface ImportResult {
  assets: Asset[];
  /** Markdown and plain-text files, read in full: they become text cards. */
  texts?: { name: string; text: string }[];
  skipped: string[];
}

/** What another app put on the system clipboard (files and images already imported). */
export type Pasted =
  | { kind: "files"; result: ImportResult }
  | { kind: "image"; asset: Asset }
  | { kind: "text"; text: string }
  /** Exactly the image Patchwork last put on the clipboard (Copy on a single image). */
  | { kind: "own" }
  | { kind: "empty" };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
