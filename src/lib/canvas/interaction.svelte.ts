import { commitEdit, createLinkedText, createLinks, reconnectLink } from "../actions.svelte";
import { camera, doc, history, linkSelection, selectedNodes, selectLinks, selectOnly, selection, ui } from "../app.svelte";
import { hitsNode, linkPath, pathHitsRect, sideNear } from "../links/geometry";
import { linkData, linkSides } from "../links/palette";
import { aabb, bounds, frameOf, intersects, normalizeDeg, rotate, toDeg, type Frame, type Point } from "../doc/geometry";
import { applyOp, type NodeChange, type Op } from "../doc/ops.svelte";
import { frameAt, frameEdgeHit, frames, frameUi, membersIn, reassign, shown, shownNode, withMembers } from "../frame/frames.svelte";
import { isPin, pinHoverBox } from "../pin/model";
import { isSprite } from "../sprite/model";
import { familyTargets, withFamily } from "../parent/parents.svelte";
import { mapDown, mapHover, mapMove, mapUi, mapUp } from "../map/map.svelte";
import { hoverPick, leavePick, paletteUi, pickAt } from "../palette/palette.svelte";
import { currentTool, drawUi, endErase, endStroke, eraseAt, extendStroke, isDrawing, nearStrokes, startErase, startStroke } from "../drawing/draw.svelte";
import { frameData, isFrame, MIN_FRAME_H, MIN_FRAME_W } from "../frame/model";
import type { CanvasNode, LinkSide, Rect } from "../doc/types";
import { MAX_FONT, MIN_FONT } from "../text/palette";
import { crop } from "./crop.svelte";
import { focusOf, slotOf } from "./slot";
import { textData } from "../text/palette";
import { fontSizeOf, growShift, isFlow, withFontSize } from "./flow";
import { play } from "../juice/sound";
import { isMac } from "../platform";
import { settings } from "../settings.svelte";
import { snap } from "./layout";

const DRAG_THRESHOLD = 3;
/** Momentum and smooth zoom: the "Smooth camera" setting, off in calm mode. */
const smoothCamera = () => settings.smoothCamera && !settings.calm;
const ROTATE_STEP = 15;
const MIN_SIDE = 8;
/** Degrees of tilt per px/ms of horizontal drag speed, and the cap. */
const TILT_PER_SPEED = 5;
const MAX_TILT = 7;
export const MIN_TEXT_WIDTH = 60;
/** How far outside a node (screen px) its link handles stay reachable. */
const HOVER_MARGIN = 30;
/** A link handle dragged at least this far (screen px) onto empty canvas creates a linked card. */
const LINK_OUT_MIN = 40;
/** Screen px between a node's edge and its link handles (side dots). */
export const LINK_DOT_GAP = 16;
/** How close (screen px) to a side dot a dragged link end pins to that side. */
const SIDE_REACH = 14;
/** The rotate handle's center, screen px out from the selection's top edge (SelectionBox). */
export const ROTATE_REACH = 24;
/** Screen px at the top taken by the board pill and toolbar, and at the bottom by the status bar. */
const TOP_CHROME = 64;
const BOTTOM_CHROME = 56;

/** A link being dragged: a new one out of a handle, or an existing one's end being reconnected. */
export interface LinkDraft {
  /** The ends that stay put: a node, its pinned side, and whether it's the link's `to` end. */
  fixed: { node: string; side: LinkSide | null; isTo: boolean }[];
  /** The loose end, in world units. */
  to: Point;
  /** The node it would attach to, and the side dot it's over (null: the facing side). */
  target: string | null;
  side: LinkSide | null;
  /** The link being reconnected, drawn faded meanwhile. */
  relink: string | null;
}

/**
 * Selection-box handles. Corners scale uniformly; e/w change a text node's width. A frame's
 * handles (corners and all four edges, n/s included) resize its box instead.
 */
export type Handle = "nw" | "ne" | "se" | "sw" | "n" | "e" | "s" | "w" | "rotate";

const HANDLE_DIR: Record<Exclude<Handle, "rotate">, Point> = {
  nw: { x: -1, y: -1 },
  ne: { x: 1, y: -1 },
  se: { x: 1, y: 1 },
  sw: { x: -1, y: 1 },
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

type Gesture =
  | {
      kind: "pan";
      lastX: number;
      lastY: number;
      /** Recent pointer positions with times, to measure the speed of a throw on release. */
      trail: { x: number; y: number; t: number }[];
    }
  /** Dragging a filled picture to choose which part shows. */
  | { kind: "crop"; id: string; startX: number; startY: number; focus: { x: number; y: number }; start: CanvasNode }
  | {
      kind: "drag";
      startX: number;
      startY: number;
      anchorId: string;
      starts: Map<string, CanvasNode>;
      moved: boolean;
      /** Plain click on an already-selected node narrows the selection to it on release. */
      collapseTo: string | null;
      /** Last snapped offset, so each new grid cell can tick. */
      snapped: string;
      /**
       * Pressed on a locked node: moving turns the drag into a marquee from this point (viewport),
       * as on empty canvas. Additive keeps the selection as the marquee's base.
       */
      marqueeFrom: { x: number; y: number; additive: boolean } | null;
    }
  | { kind: "marquee"; startX: number; startY: number; base: Set<string> }
  /** Draw mode: a stroke, or the eraser. */
  | { kind: "draw" }
  | { kind: "erase" }
  /** Editing a map: painting, erasing, a room rectangle. */
  | { kind: "map" }
  | { kind: "link"; sources: string[]; startX: number; startY: number }
  | { kind: "relink"; link: string; end: "from" | "to" }
  | {
      kind: "resize";
      handle: Exclude<Handle, "rotate">;
      /** The frame being resized, as it was. */
      start: CanvasNode;
      from: Point;
      /** Last box, so each change can tick. */
      last: string;
    }
  | {
      kind: "transform";
      handle: Handle;
      frame: Frame;
      start: Point;
      starts: Map<string, CanvasNode>;
      /** Last rotation step or scale notch, so crossing one can tick. */
      notch: number;
    };

/** Pointer, wheel and pinch handling for the canvas viewport. */
export class Interaction {
  /** Marquee rectangle in viewport (screen) coordinates. */
  marquee = $state<Rect | null>(null);
  spaceHeld = $state(false);
  panning = $state(false);
  /** True while the camera is moving; lets the camera layer use a cheap composited transform. */
  cameraMoving = $state(false);
  /** Set while rotating a multi-selection, whose box would otherwise snap back to axis-aligned. */
  boxOverride = $state<Frame | null>(null);
  /** The active transform handle, for cursor feedback. */
  activeHandle = $state<Handle | null>(null);
  /** True while dragged nodes are picked up (visual lift; the selection box hides). */
  lifting = $state(false);
  /** The nodes a drag is moving: the selection plus the members of selected frames. */
  dragged = $state.raw<Set<string>>(new Set());
  /** Visual tilt of lifted nodes in degrees, from horizontal drag speed. Not part of the document. */
  tilt = $state(0);
  /** The node under (or just around) the pointer, which shows its link handles. */
  hoverId = $state<string | null>(null);
  /** A link being dragged: new out of a handle, or an existing one's end. See `LinkDraft`. */
  linkDraft = $state<LinkDraft | null>(null);
  /** True during any pointer gesture (handles hide meanwhile). */
  busy = $state(false);

  /** The selection box in world space: the node's own frame for one node, else the bounds. */
  box = $derived.by((): Frame | null => {
    if (this.boxOverride) return this.boxOverride;
    const nodes = selectedNodes();
    if (nodes.length === 1) return frameOf(nodes[0]);
    const b = bounds(nodes);
    return b && { cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, rotation: 0 };
  });

  /**
   * The rotate handle goes below the selection instead of above it when above would put it under
   * the toolbar or board pill (and below has room). It holds still while a handle is dragged.
   */
  rotateBelow = $derived.by(() => {
    const b = this.box;
    if (!b || ui.chromeHidden) return (this.#below = false);
    if (this.activeHandle) return this.#below;
    const handleY = (dir: number) => b.cy * camera.zoom + camera.y + rotate({ x: 0, y: dir * ((b.h / 2) * camera.zoom + ROTATE_REACH) }, b.rotation).y;
    return (this.#below = handleY(-1) < TOP_CHROME && handleY(1) < camera.height - BOTTOM_CHROME);
  });
  #below = false;

  #gesture: Gesture | null = null;
  #origin = { left: 0, top: 0 };
  #movingTimer = 0;
  #pinchScale = 1;
  #lastMove = { x: 0, t: 0 };
  #tiltTimer = 0;

  #local(e: { clientX: number; clientY: number }) {
    return { x: e.clientX - this.#origin.left, y: e.clientY - this.#origin.top };
  }

  #setOrigin(viewport: HTMLElement) {
    const rect = viewport.getBoundingClientRect();
    this.#origin = { left: rect.left, top: rect.top };
  }

  #markCameraMoving() {
    this.cameraMoving = true;
    clearTimeout(this.#movingTimer);
    this.#movingTimer = window.setTimeout(() => (this.cameraMoving = false), 160);
  }

  /** What a transform changes: the selection and what hangs from it (locked nodes stay). */
  #snapshotSelection() {
    const ids = withFamily(selection.values(), true);
    return new Map(ids.map((id) => [id, $state.snapshot(doc.nodes[id]) as CanvasNode]));
  }

  /**
   * What a drag moves: the selection, everything inside selected frames, and what hangs from them.
   * Locked nodes stay.
   */
  #snapshotDrag() {
    const ids = withFamily(withMembers([...selection.values()]).filter((id) => doc.nodes[id]), true);
    return new Map(ids.map((id) => [id, $state.snapshot(doc.nodes[id]) as CanvasNode]));
  }

  /** The frame a dragged node would belong to if dropped now (frames being dragged excluded). */
  #frameUnder(n: CanvasNode, moving: Set<string>): string | null {
    const movingFrames = new Set([...moving].filter((id) => isFrame(doc.nodes[id])));
    return frameAt({ x: n.x + n.w / 2, y: n.y + n.h / 2 }, movingFrames);
  }

  pointerDown(e: PointerEvent, viewport: HTMLElement) {
    const target = e.target as HTMLElement;
    // Let the text editor handle its own clicks; anything else ends the edit.
    if (target.closest("[data-editor]")) return;
    if (ui.editing || ui.editingLink) commitEdit();
    ui.menu = null;
    // Grabbing the canvas (or anything on it) stops a glide.
    camera.stop();

    this.#setOrigin(viewport);
    const p = this.#local(e);

    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
      e.preventDefault();
      this.#begin(e, viewport, { kind: "pan", lastX: p.x, lastY: p.y, trail: [{ ...p, t: e.timeStamp }] });
      this.panning = true;
      return;
    }
    if (mapUi.editing) {
      if (e.button === 0) {
        e.preventDefault();
        mapDown(camera.toWorld(p.x, p.y), e);
        this.#begin(e, viewport, { kind: "map" });
      }
      return;
    }
    if (paletteUi.picking) {
      if (e.button === 0) {
        e.preventDefault();
        void pickAt(camera.toWorld(p.x, p.y));
      }
      return;
    }
    if (drawUi.active) {
      // A pen's eraser end reports button 5: it erases whatever the tool.
      if (e.button !== 0 && e.button !== 5) return;
      e.preventDefault();
      const w = camera.toWorld(p.x, p.y);
      drawUi.penEraser = e.button === 5;
      if (currentTool() === "eraser") {
        startErase(w);
        this.#begin(e, viewport, { kind: "erase" });
      } else {
        startStroke(w, e);
        this.#begin(e, viewport, { kind: "draw" });
      }
      return;
    }
    if (e.button !== 0) return;

    const handle = target.closest<HTMLElement>("[data-handle]")?.dataset.handle as Handle | undefined;
    const nodes = selectedNodes();
    if (handle && handle !== "rotate" && nodes.length === 1 && isFrame(nodes[0])) {
      this.activeHandle = handle;
      const start = $state.snapshot(nodes[0]) as CanvasNode;
      this.#begin(e, viewport, { kind: "resize", handle, start, from: camera.toWorld(p.x, p.y), last: "" });
      return;
    }
    if (handle && this.box) {
      this.activeHandle = handle;
      this.#begin(e, viewport, {
        kind: "transform",
        handle,
        frame: { ...this.box },
        start: camera.toWorld(p.x, p.y),
        starts: this.#snapshotSelection(),
        notch: handle === "rotate" ? Math.round(this.box.rotation / ROTATE_STEP) : 0,
      });
      return;
    }

    const additive = e.shiftKey || (isMac ? e.metaKey : e.ctrlKey);

    // A selected link's end handle: reconnect that end.
    const end = target.closest<HTMLElement>("[data-link-end]")?.dataset.linkEnd;
    const endLink = end ? doc.links[end.split(":")[0]] : undefined;
    if (end && endLink) {
      const which = end.split(":")[1] as "from" | "to";
      const d = linkData(endLink.data);
      const fixed = which === "from"
        ? { node: endLink.to, side: d.toSide ?? null, isTo: true }
        : { node: endLink.from, side: d.fromSide ?? null, isTo: false };
      this.#begin(e, viewport, { kind: "relink", link: endLink.id, end: which });
      this.linkDraft = {
        fixed: [fixed],
        to: camera.toWorld(p.x, p.y),
        target: endLink[which],
        side: (which === "from" ? d.fromSide : d.toSide) ?? null,
        relink: endLink.id,
      };
      play("tap", { pitch: 1.25 });
      return;
    }

    // A node's link handle: a new link, from every selected node when this one is among them.
    const linkFrom = target.closest<HTMLElement>("[data-link-handle]")?.dataset.linkHandle;
    if (linkFrom && doc.nodes[linkFrom]) {
      const group = [...selection.values()].filter((id) => doc.nodes[id]);
      const sources = group.length > 1 && group.includes(linkFrom) ? group : [linkFrom];
      this.#begin(e, viewport, { kind: "link", sources, startX: e.clientX, startY: e.clientY });
      this.linkDraft = {
        fixed: sources.map((node) => ({ node, side: null, isTo: false })),
        to: camera.toWorld(p.x, p.y),
        target: null,
        side: null,
        relink: null,
      };
      play("tap", { pitch: 1.25 });
      return;
    }

    const link = target.closest<SVGElement>("[data-link-id]")?.dataset.linkId;
    if (link) {
      if (additive && linkSelection.has(link)) linkSelection.delete(link);
      else if (additive) {
        selection.clear();
        linkSelection.add(link);
      } else selectLinks([link]);
      play("select", { volume: 0.4 });
      return;
    }

    const hit = target.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    // Nodes and links are never selected together.
    linkSelection.clear();

    if (!hit) {
      if (!additive) selection.clear();
      this.#begin(e, viewport, { kind: "marquee", startX: p.x, startY: p.y, base: new Set(selection.values()) });
      this.marquee = { x: p.x, y: p.y, w: 0, h: 0 };
      return;
    }

    // Repositioning a filled picture: the drag moves the picture inside its box, not the node.
    if (crop.id === hit && !additive && slotOf(doc.nodes[hit]) === "fill") {
      const n = doc.nodes[hit];
      this.#begin(e, viewport, { kind: "crop", id: hit, startX: e.clientX, startY: e.clientY, focus: focusOf(n), start: $state.snapshot(n) as CanvasNode });
      return;
    }
    if (crop.id && crop.id !== hit) crop.id = null;

    let collapseTo: string | null = null;
    if (additive) {
      if (selection.has(hit)) {
        selection.delete(hit);
        play("tap", { pitch: 0.8 });
        return; // toggled off: nothing to drag
      }
      selection.add(hit);
      play("select", { volume: 0.4 });
    } else if (!selection.has(hit)) {
      selectOnly([hit]);
      play("select", { volume: 0.4 });
    } else if (selection.size > 1) {
      collapseTo = hit;
    }

    this.#begin(e, viewport, {
      kind: "drag",
      startX: e.clientX,
      startY: e.clientY,
      anchorId: hit,
      starts: this.#snapshotDrag(),
      moved: false,
      collapseTo,
      snapped: "0,0",
      marqueeFrom: doc.nodes[hit].locked ? { x: p.x, y: p.y, additive } : null,
    });
  }

  #begin(e: PointerEvent, el: HTMLElement, gesture: Gesture) {
    this.#gesture = gesture;
    this.busy = true;
    this.#capture = { el, pointerId: e.pointerId };
  }

  /**
   * Captured on the first move, not on press. While the canvas holds capture, Chromium delivers
   * the following click and dblclick to it instead of the element under the pointer, which broke
   * double-clicking a card and Ctrl+clicking a link inside one.
   */
  #capture: { el: HTMLElement; pointerId: number } | null = null;

  pointerMove(e: PointerEvent) {
    const g = this.#gesture;
    if (drawUi.active) {
      drawUi.cursor = this.#local(e);
      if (this.hoverId) this.hoverId = null;
    }
    if (!g) {
      if (mapUi.editing) {
        const q = this.#local(e);
        mapHover(camera.toWorld(q.x, q.y));
      } else if (paletteUi.picking) {
        const q = this.#local(e);
        void hoverPick(camera.toWorld(q.x, q.y), q);
      } else if (!drawUi.active) this.#hover(e);
      return;
    }
    if (this.#capture) {
      const { el, pointerId } = this.#capture;
      this.#capture = null;
      if (el.isConnected) el.setPointerCapture(pointerId);
    }
    const p = this.#local(e);

    switch (g.kind) {
      case "pan":
        camera.panBy(p.x - g.lastX, p.y - g.lastY);
        g.lastX = p.x;
        g.lastY = p.y;
        g.trail.push({ ...p, t: e.timeStamp });
        if (g.trail.length > 12) g.trail.shift();
        this.#markCameraMoving();
        break;
      case "drag":
        this.#drag(g, e);
        break;
      case "marquee":
        this.#marquee(g, p);
        break;
      case "draw":
        // Every sample since the last event, for a smooth line from a fast pen (none for synthetic events).
        for (const ev of e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]) {
          const q = this.#local(ev);
          extendStroke(camera.toWorld(q.x, q.y), ev);
        }
        break;
      case "erase":
        eraseAt(camera.toWorld(p.x, p.y));
        break;
      case "map":
        mapMove(camera.toWorld(p.x, p.y));
        break;
      case "transform":
        this.#transform(g, camera.toWorld(p.x, p.y), e);
        break;
      case "crop":
        this.#crop(g, e);
        break;
      case "resize":
        this.#resizeFrame(g, camera.toWorld(p.x, p.y), e);
        break;
      case "link":
      case "relink":
        this.#linkMove(camera.toWorld(p.x, p.y));
        break;
    }
  }

  /** Tracks which node shows link handles: the topmost one under the pointer or just around it. */
  #hover(e: PointerEvent) {
    // Over a handle the current node keeps its handles.
    if ((e.target as Element).closest?.("[data-link-handle], [data-link-end]")) return;
    const rect = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    if (!rect) return;
    const p = camera.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const margin = HOVER_MARGIN / camera.zoom;
    let best: { id: string; z: number } | null = null;
    for (const n of doc.nodeList) {
      if (isFrame(n) || frames.hidden.has(n.id)) continue;
      // Pins are drawn on top of everything, by their marker.
      const z = isPin(n) ? Infinity : n.z;
      if ((!best || z > best.z) && this.#touches(n, p, margin)) best = { id: n.id, z };
    }
    // Frames are under every node: only when no node is near, by their title bar or border.
    const id = best?.id ?? frames.list.find((f) => frameEdgeHit(f, p, margin))?.id ?? null;
    if (id !== this.hoverId) this.hoverId = id;
  }

  /** Whether the pointer is on (or `margin` around) a node: a drawing that isn't selected by its strokes only. */
  #touches(n: CanvasNode, p: Point, margin: number) {
    if (!hitsNode(isPin(n) ? pinHoverBox(shown(n)) : shown(n), p, margin)) return false;
    return !isDrawing(n) || selection.has(n.id) || nearStrokes(n, p, margin);
  }

  /** The pointer left the canvas. */
  leave() {
    if (!this.#gesture) this.hoverId = null;
    drawUi.cursor = null;
    leavePick();
    mapHover(null);
  }

  /**
   * Follows a dragged link end. It attaches to the topmost node whose body is under the pointer
   * (facing side) or whose side dot is near it (that side pinned). The fixed ends can't be targets.
   */
  #linkMove(p: Point) {
    const draft = this.linkDraft;
    if (!draft) return;
    const exclude = new Set(draft.fixed.map((f) => f.node));
    const gap = LINK_DOT_GAP / camera.zoom, reach = SIDE_REACH / camera.zoom, margin = HOVER_MARGIN / camera.zoom;
    let best: { id: string; z: number; side: LinkSide | null } | null = null;
    for (const node of doc.nodeList) {
      const n = shown(node), z = isPin(n) ? Infinity : n.z;
      if (exclude.has(n.id) || isFrame(n) || frames.hidden.has(n.id) || (best && z <= best.z) || !this.#touches(node, p, margin)) continue;
      const side = sideNear(n, p, gap, reach);
      if (side || hitsNode(n, p)) best = { id: n.id, z, side };
    }
    // Then frames (under every node): a side dot, the title bar or the border. Their empty inside
    // stays canvas, where a drop makes a new card in the frame.
    if (!best) {
      for (const f of frames.list) {
        if (exclude.has(f.id)) continue;
        const side = sideNear(f, p, gap, reach);
        if (side || frameEdgeHit(f, p, reach)) {
          best = { id: f.id, z: 0, side };
          break;
        }
      }
    }
    const target = best?.id ?? null, side = best?.side ?? null;
    if (target && (target !== draft.target || side !== draft.side)) play("tap", { volume: 0.45, pitch: side ? 1.45 : 1.3 });
    this.linkDraft = { ...draft, to: p, target, side };
  }

  #drag(g: Extract<Gesture, { kind: "drag" }>, e: PointerEvent) {
    const sx = e.clientX - g.startX, sy = e.clientY - g.startY;
    if (!g.moved && Math.hypot(sx, sy) < DRAG_THRESHOLD) return;
    if (!g.moved && g.marqueeFrom) {
      const { x, y, additive } = g.marqueeFrom;
      if (!additive) selection.clear();
      const marquee: Gesture = { kind: "marquee", startX: x, startY: y, base: new Set(selection.values()) };
      this.#gesture = marquee;
      this.#marquee(marquee, this.#local(e));
      return;
    }
    if (!g.moved) {
      g.moved = true;
      this.lifting = true;
      this.dragged = new Set(g.starts.keys());
      // Frames whose members are dragged (without the frame) hold still, so a member can leave.
      for (const id of g.starts.keys()) {
        const owner = frames.owner.get(id);
        if (owner && !g.starts.has(owner)) frameUi.frozen.add(owner);
      }
      this.#lastMove = { x: e.clientX, t: performance.now() };
      play("tap", { pitch: 1.2 });
    }
    this.#updateTilt(e);
    let dx = sx / camera.zoom, dy = sy / camera.zoom;
    // Snap the grabbed node to the grid; the rest keep their relative offsets. Alt inverts the setting.
    const anchor = g.starts.get(g.anchorId);
    if (anchor && settings.snap !== e.altKey) {
      dx = snap(anchor.x + dx) - anchor.x;
      dy = snap(anchor.y + dy) - anchor.y;
      const key = `${dx},${dy}`;
      if (key !== g.snapped) play("tap", { volume: 0.35, throttle: 40, jitter: 0.1 });
      g.snapped = key;
    }
    for (const [id, s] of g.starts) {
      const n = doc.nodes[id];
      if (n) {
        n.x = s.x + dx;
        n.y = s.y + dy;
      }
    }
    // Highlight the frame the grabbed node would join (not the one it's already in).
    const anchorNode = doc.nodes[g.anchorId];
    const owner = frames.owner.get(g.anchorId) ?? null;
    const into = anchorNode && !isFrame(anchorNode) && !(owner && g.starts.has(owner)) ? this.#frameUnder(anchorNode, this.dragged) : null;
    const highlight = into !== owner ? into : null;
    if (frameUi.dropTarget !== highlight) frameUi.dropTarget = highlight;
    // And the frame it would leave, so it's clear when it has been dragged far enough.
    const leaving = owner && !g.starts.has(owner) && into !== owner ? owner : null;
    if (frameUi.leaving !== leaving) {
      play("tap", { volume: 0.4, pitch: leaving ? 0.75 : 1.15 });
      frameUi.leaving = leaving;
    }
  }

  /** Leans lifted nodes into the direction of travel; they straighten once the pointer rests. */
  #updateTilt(e: PointerEvent) {
    const now = performance.now();
    const speed = (e.clientX - this.#lastMove.x) / Math.max(1, now - this.#lastMove.t);
    this.#lastMove = { x: e.clientX, t: now };
    if (settings.calm) return;
    const target = Math.max(-MAX_TILT, Math.min(MAX_TILT, speed * TILT_PER_SPEED));
    this.tilt = this.tilt * 0.6 + target * 0.4;
    clearTimeout(this.#tiltTimer);
    this.#tiltTimer = window.setTimeout(() => (this.tilt = 0), 70);
  }

  /**
   * Dragging moves the picture with the pointer: the part of it that overflows the box is what
   * the drag can reveal, so the focus changes by the drag over that overflow.
   */
  #crop(g: Extract<Gesture, { kind: "crop" }>, e: PointerEvent) {
    const n = doc.nodes[g.id];
    const asset = n && doc.assetOf(n);
    if (!n || !asset?.width || !asset.height) return;
    const k = Math.max(n.w / asset.width, n.h / asset.height);
    const over = { x: asset.width * k - n.w, y: asset.height * k - n.h };
    const d = rotate({ x: (e.clientX - g.startX) / camera.zoom, y: (e.clientY - g.startY) / camera.zoom }, -n.rotation);
    const flip = (n.data ?? {}) as { flipX?: boolean; flipY?: boolean };
    const fx = flip.flipX ? -1 : 1, fy = flip.flipY ? -1 : 1;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    // Dragging right shows more of the left: the focus moves the other way.
    const x = over.x > 0.5 ? clamp(g.focus.x - (fx * d.x) / over.x) : g.focus.x;
    const y = over.y > 0.5 ? clamp(g.focus.y - (fy * d.y) / over.y) : g.focus.y;
    n.data = { ...((n.data ?? {}) as object), focus: { x, y } };
  }

  #marquee(g: Extract<Gesture, { kind: "marquee" }>, p: Point) {
    const m = {
      x: Math.min(g.startX, p.x),
      y: Math.min(g.startY, p.y),
      w: Math.abs(p.x - g.startX),
      h: Math.abs(p.y - g.startY),
    };
    this.marquee = m;
    const tl = camera.toWorld(m.x, m.y);
    const world = { x: tl.x, y: tl.y, w: m.w / camera.zoom, h: m.h / camera.zoom };
    const next = new Set(g.base);
    for (const n of doc.nodeList) {
      // Locked nodes are selected by clicking, so a locked background never joins a marquee.
      if (frames.hidden.has(n.id) || n.locked) continue;
      const r = aabb(n);
      // A frame needs to be fully inside, so a marquee started within a frame selects what's in it.
      const caught = isFrame(n)
        ? r.x >= world.x && r.y >= world.y && r.x + r.w <= world.x + world.w && r.y + r.h <= world.y + world.h
        : intersects(world, r);
      if (caught) next.add(n.id);
    }
    // A marquee that catches no nodes selects the links it crosses.
    const links = new Set<string>();
    if (next.size === 0) {
      for (const l of doc.linkList) {
        const a = shownNode(l.from), b = shownNode(l.to);
        if (a && b && a !== b && pathHitsRect(linkPath(a, b, linkData(l.data).shape, linkSides(l.data)), world)) links.add(l.id);
      }
    }
    const before = selection.size + linkSelection.size, after = next.size + links.size;
    if (after !== before) play("tap", { volume: 0.4, throttle: 30, pitch: after > before ? 1.15 : 0.85 });
    for (const id of selection.values()) if (!next.has(id)) selection.delete(id);
    for (const id of next) selection.add(id);
    for (const id of linkSelection.values()) if (!links.has(id)) linkSelection.delete(id);
    for (const id of links) linkSelection.add(id);
  }

  #transform(g: Extract<Gesture, { kind: "transform" }>, p: Point, e: PointerEvent) {
    const f = g.frame;
    const center = { x: f.cx, y: f.cy };
    const toLocal = (pt: Point) => rotate({ x: pt.x - f.cx, y: pt.y - f.cy }, -f.rotation);

    if (g.handle === "rotate") {
      let delta = toDeg(Math.atan2(p.y - f.cy, p.x - f.cx) - Math.atan2(g.start.y - f.cy, g.start.x - f.cx));
      if (e.shiftKey) delta = Math.round((f.rotation + delta) / ROTATE_STEP) * ROTATE_STEP - f.rotation;
      this.#tick(g, Math.round((f.rotation + delta) / ROTATE_STEP));
      for (const [id, s] of g.starts) {
        const n = doc.nodes[id];
        if (!n) continue;
        const c = rotate({ x: s.x + s.w / 2 - center.x, y: s.y + s.h / 2 - center.y }, delta);
        n.x = center.x + c.x - s.w / 2;
        n.y = center.y + c.y - s.h / 2;
        // Pins stay upright markers.
        if (!isPin(s)) n.rotation = normalizeDeg(s.rotation + delta);
      }
      if (g.starts.size > 1) this.boxOverride = { ...f, rotation: f.rotation + delta };
      return;
    }

    const dir = HANDLE_DIR[g.handle];
    const local = toLocal(p);

    // A picture slot resizes freely from any handle: its box changes shape, the picture follows.
    const only = g.starts.size === 1 ? [...g.starts.values()][0] : null;
    if (only && slotOf(only)) {
      const n = doc.nodes[only.id];
      if (!n) return;
      const grid = (v: number) => (settings.snap !== e.altKey ? Math.max(MIN_SIDE, snap(v)) : v);
      // Edges in the node's own (rotated) frame, relative to the starting center; the size snaps, not the edges.
      let left = -only.w / 2, right = only.w / 2, top = -only.h / 2, bottom = only.h / 2;
      if (dir.x < 0) left = right - Math.max(MIN_SIDE, grid(right - local.x));
      if (dir.x > 0) right = left + Math.max(MIN_SIDE, grid(local.x - left));
      if (dir.y < 0) top = bottom - Math.max(MIN_SIDE, grid(bottom - local.y));
      if (dir.y > 0) bottom = top + Math.max(MIN_SIDE, grid(local.y - top));
      const w = right - left, h = bottom - top;
      const c = rotate({ x: (left + right) / 2, y: (top + bottom) / 2 }, f.rotation);
      n.w = w;
      n.h = h;
      n.x = f.cx + c.x - w / 2;
      n.y = f.cy + c.y - h / 2;
      this.#tick(g, Math.round(w / 20) * 1000 + Math.round(h / 20));
      return;
    }

    // A fixed-height text card: the top and bottom edges change its height (the width stays).
    if (only && only.kind === "text" && textData(only.data).fixed && dir.x === 0) {
      const n = doc.nodes[only.id];
      if (!n) return;
      const grid = (v: number) => (settings.snap !== e.altKey ? Math.max(MIN_SIDE, snap(v)) : v);
      let top = -only.h / 2, bottom = only.h / 2;
      if (dir.y < 0) top = bottom - Math.max(MIN_SIDE, grid(bottom - local.y));
      else bottom = top + Math.max(MIN_SIDE, grid(local.y - top));
      const h = bottom - top;
      const c = rotate({ x: 0, y: (top + bottom) / 2 }, f.rotation);
      n.h = h;
      n.x = f.cx + c.x - n.w / 2;
      n.y = f.cy + c.y - h / 2;
      this.#tick(g, Math.round(h / 20));
      return;
    }

    if (dir.y === 0) {
      // Edge: change width of a single text node; height follows its content.
      const [id, s] = [...g.starts][0];
      const n = doc.nodes[id];
      if (!n) return;
      const w = e.altKey
        ? Math.max(MIN_TEXT_WIDTH, Math.abs(local.x) * 2)
        : Math.max(MIN_TEXT_WIDTH, dir.x * (local.x + (dir.x * f.w) / 2));
      const cxLocal = e.altKey ? 0 : -dir.x * (f.w / 2) + dir.x * (w / 2);
      const c = rotate({ x: cxLocal, y: 0 }, f.rotation);
      // The height has followed the new width (measured): a rotated card keeps its top edge.
      const grown = growShift(0, n.h - s.h, f.rotation);
      n.w = w;
      n.x = f.cx + c.x - w / 2 + grown.x;
      n.y = f.cy + c.y - s.h / 2 + grown.y;
      return;
    }

    // Corner: uniform scale about the opposite corner (or the center with Alt).
    const handle = { x: (dir.x * f.w) / 2, y: (dir.y * f.h) / 2 };
    const anchor = e.altKey ? { x: 0, y: 0 } : { x: -handle.x, y: -handle.y };
    const v0 = { x: handle.x - anchor.x, y: handle.y - anchor.y };
    const v = { x: local.x - anchor.x, y: local.y - anchor.y };
    // Pins are points: they only move.
    const minScale = Math.max(0, ...[...g.starts.values()].filter((s) => !isPin(s)).map((s) => MIN_SIDE / Math.min(s.w, s.h)));
    let k = Math.max(minScale, (v.x * v0.x + v.y * v0.y) / (v0.x * v0.x + v0.y * v0.y));
    // A sprite on its own scales by whole multiples of its pixels, so they stay square (ticking on each).
    const [first] = g.starts.values();
    const pixels = selection.size === 1 && first && isSprite(first) ? doc.assetOf(first)?.width : 0;
    if (pixels) {
      const multiple = Math.max(1, Math.round((first.w * k) / pixels));
      k = (multiple * pixels) / first.w;
      this.#tick(g, multiple);
    } else this.#tick(g, Math.round(Math.log(k) / Math.log(1.1)));
    const a = rotate(anchor, f.rotation);
    const anchorWorld = { x: f.cx + a.x, y: f.cy + a.y };

    for (const [id, s] of g.starts) {
      const n = doc.nodes[id];
      if (!n) continue;
      const cx = anchorWorld.x + (s.x + s.w / 2 - anchorWorld.x) * k;
      const cy = anchorWorld.y + (s.y + s.h / 2 - anchorWorld.y) * k;
      n.w = s.w * k;
      n.h = s.h * k;
      n.x = cx - n.w / 2;
      n.y = cy - n.h / 2;
      // Text and checklists: scaling scales their font; their height follows.
      if (isFlow(s)) {
        const fontSize = Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(fontSizeOf(s) * k * 10) / 10));
        n.data = withFontSize(s, fontSize);
      }
    }
  }

  /**
   * Resizes a frame from one of its edges or corners; the moving edges snap to the grid (Alt
   * inverts). An auto-fit frame becomes manual from the first move.
   */
  #resizeFrame(g: Extract<Gesture, { kind: "resize" }>, p: Point, e: PointerEvent) {
    const f = doc.nodes[g.start.id];
    if (!f) return;
    const dir = HANDLE_DIR[g.handle], r = g.start;
    const dx = p.x - g.from.x, dy = p.y - g.from.y;
    const grid = (v: number) => (settings.snap !== e.altKey ? snap(v) : v);
    let left = r.x, top = r.y, right = r.x + r.w, bottom = r.y + r.h;
    if (dir.x < 0) left = Math.min(grid(left + dx), right - MIN_FRAME_W);
    if (dir.x > 0) right = Math.max(grid(right + dx), left + MIN_FRAME_W);
    if (dir.y < 0) top = Math.min(grid(top + dy), bottom - MIN_FRAME_H);
    if (dir.y > 0) bottom = Math.max(grid(bottom + dy), top + MIN_FRAME_H);
    const box = { x: left, y: top, w: right - left, h: bottom - top };
    const key = `${box.x},${box.y},${box.w},${box.h}`;
    if (key === g.last) return;
    if (g.last) play("tap", { volume: 0.35, throttle: 40, jitter: 0.1 });
    g.last = key;
    Object.assign(f, box);
    f.data = { ...frameData(f.data), size: { w: box.w, h: box.h } };
  }

  /** Ticks when a transform crosses into a new rotation step or scale notch. */
  #tick(g: Extract<Gesture, { kind: "transform" }>, notch: number) {
    if (notch === g.notch) return;
    play("tap", { volume: 0.35, throttle: 30, pitch: notch > g.notch ? 1.1 : 0.9 });
    g.notch = notch;
  }

  pointerUp(e?: PointerEvent) {
    const g = this.#gesture;
    this.#gesture = null;
    this.#capture = null;
    this.busy = false;
    const draft = this.linkDraft;
    this.linkDraft = null;
    this.panning = false;
    this.marquee = null;
    this.boxOverride = null;
    this.activeHandle = null;
    this.lifting = false;
    this.tilt = 0;
    clearTimeout(this.#tiltTimer);
    const dragged = this.dragged;
    this.dragged = new Set();
    frameUi.frozen.clear();
    frameUi.dropTarget = null;
    frameUi.leaving = null;

    if (g?.kind === "pan" && e && smoothCamera()) this.#throw(g.trail, e.timeStamp);
    if (g?.kind === "draw") endStroke();
    if (g?.kind === "erase") endErase();
    if (g?.kind === "map") mapUp();
    drawUi.penEraser = false;

    if (g?.kind === "drag") {
      if (!g.moved && g.collapseTo) selectOnly([g.collapseTo]);
      else if (g.moved) {
        // Each dragged node (not moving with its frame) joins the frame its center landed in, or none.
        const targets = new Map<string, string | null>();
        for (const id of g.starts.keys()) {
          const n = doc.nodes[id];
          const owner = frames.owner.get(id) ?? null;
          if (!n || isFrame(n) || (owner && g.starts.has(owner))) continue;
          const into = this.#frameUnder(n, dragged);
          if (into !== owner) targets.set(id, into);
        }
        const ops = reassign(familyTargets(targets));
        const inverses = ops.map((op) => applyOp(doc, op));
        const joined = [...targets.values()].some((t) => t !== null);
        const label = !targets.size
          ? g.starts.size > 1 ? `Move ${g.starts.size} nodes` : "Move node"
          : joined ? "Move into frame" : "Move out of frame";
        this.#commit(g.starts, label, ops, inverses);
        const tucked = [...targets].filter((t): t is [string, string] => !!t[1] && frameData(doc.nodes[t[1]]?.data).collapsed);
        if (tucked.length) this.#tuck(tucked);
        else play(targets.size ? (joined ? "select" : "tap") : "button", { volume: 0.5, pitch: 0.9 });
      }
    } else if (g?.kind === "link" && draft) {
      const far = e && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) >= LINK_OUT_MIN;
      if (draft.target) createLinks(g.sources, draft.target, draft.side);
      else if (far) createLinkedText(g.sources, draft.to);
    } else if (g?.kind === "relink" && draft) {
      // Dropped away from any node: the end snaps back.
      if (draft.target) reconnectLink(g.link, g.end, draft.target, draft.side);
    } else if (g?.kind === "resize" && g.last) {
      // The box decides membership: what's inside belongs to the frame, what's left outside leaves.
      const f = doc.nodes[g.start.id];
      if (f) {
        const d = frameData(f.data);
        const before = new Set(d.members.filter((id) => doc.nodes[id]));
        const members = membersIn(f, f.id);
        f.data = { ...d, members };
        const after = members.filter((id) => doc.nodes[id]);
        const joined = after.some((id) => !before.has(id)), left = after.length < before.size;
        this.#commit(new Map([[f.id, g.start]]), "Resize frame");
        play(joined ? "select" : left ? "tap" : "button", { volume: 0.5, pitch: 0.9 });
      }
    } else if (g?.kind === "crop") {
      this.#commit(new Map([[g.id, g.start]]), "Reposition picture");
    } else if (g?.kind === "transform") {
      const slot = g.starts.size === 1 && slotOf([...g.starts.values()][0]);
      const label = g.handle === "rotate" ? "Rotate" : slot || g.handle === "n" || g.handle === "s" || g.handle === "e" || g.handle === "w" ? "Resize" : "Scale";
      this.#commit(g.starts, label);
    }
  }

  /**
   * Nodes dropped into a collapsed frame shrink into its card (not in calm mode), and the frame is
   * selected in their place, since they're hidden now.
   */
  #tuck(tucked: [id: string, frame: string][]) {
    for (const [id, fid] of tucked) {
      const n = doc.nodes[id], f = doc.nodes[fid];
      selection.delete(id);
      if (!n || !f || settings.calm) continue;
      const d = rotate({ x: f.x + f.w / 2 - (n.x + n.w / 2), y: f.y + f.h / 2 - (n.y + n.h / 2) }, -n.rotation);
      frameUi.tucking.set(id, { dx: d.x, dy: d.y });
    }
    const fid = tucked[0][1];
    selection.add(fid);
    play("vanish", { volume: 0.55, pitch: 1.25 });
    setTimeout(() => {
      for (const [id] of tucked) frameUi.tucking.delete(id);
      frameUi.gulp = fid;
      play("tap", { volume: 0.45, pitch: 0.75 });
      setTimeout(() => frameUi.gulp === fid && (frameUi.gulp = null), 420);
    }, settings.calm ? 0 : 240);
  }

  /**
   * A pan released while still moving keeps gliding: the velocity over the last ~80 ms of the
   * drag. A pointer that stopped before letting go doesn't throw.
   */
  #throw(trail: { x: number; y: number; t: number }[], now: number) {
    const last = trail.at(-1);
    if (!last || now - last.t > 60) return;
    const from = trail.find((s) => last.t - s.t <= 80) ?? trail[0];
    const dt = last.t - from.t;
    if (dt < 8) return;
    camera.throw((last.x - from.x) / dt, (last.y - from.y) / dt);
  }

  /** Records the difference between snapshots and current nodes as one undo step. */
  /** `extra` ops (already applied, with their inverses) join the same step, e.g. frame membership. */
  #commit(starts: Map<string, CanvasNode>, label: string, extra: Op[] = [], extraInverses: Op[] = []) {
    const keys = ["x", "y", "w", "h", "rotation", "data"] as const;
    const forward: NodeChange[] = [];
    const backward: NodeChange[] = [];
    for (const [id, s] of starts) {
      const n = doc.nodes[id];
      if (!n) continue;
      const after: Record<string, unknown> = {};
      const before: Record<string, unknown> = {};
      for (const key of keys) {
        const now = $state.snapshot(n[key]);
        if (JSON.stringify(now) !== JSON.stringify(s[key])) {
          after[key] = now;
          before[key] = s[key];
        }
      }
      if (Object.keys(after).length) {
        forward.push({ id, props: after });
        backward.push({ id, props: before });
      }
    }
    if (forward.length || extra.length) {
      history.record(
        label,
        [{ type: "updateNodes", changes: forward }, ...extra],
        [{ type: "updateNodes", changes: backward }, ...extraInverses],
      );
    }
  }

  /** Right-click: selects the node under the cursor (if any) and opens the menu. */
  contextMenu(e: MouseEvent, viewport: HTMLElement) {
    e.preventDefault();
    if ((e.target as HTMLElement).closest("[data-editor]")) return;
    this.#setOrigin(viewport);
    const p = this.#local(e);
    const target = e.target as Element;
    const link = target.closest<SVGElement>("[data-link-id]")?.dataset.linkId;
    const hit = target.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    const onHandle = !!target.closest("[data-handle]");
    if (link && !linkSelection.has(link)) selectLinks([link]);
    else if (hit && !selection.has(hit)) selectOnly([hit]);
    ui.menu = {
      x: e.clientX,
      y: e.clientY,
      world: camera.toWorld(p.x, p.y),
      target: link || hit || onHandle ? "selection" : "canvas",
    };
  }

  wheel(e: WheelEvent, viewport: HTMLElement) {
    e.preventDefault();
    // A fixed-height card with more than it shows scrolls first; at its ends the wheel goes on to the canvas.
    const scroller = e.ctrlKey ? null : (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-scroll]");
    if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) {
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroller.clientHeight : 1);
      const max = scroller.scrollHeight - scroller.clientHeight;
      if ((dy > 0 && scroller.scrollTop < max - 0.5) || (dy < 0 && scroller.scrollTop > 0.5)) {
        scroller.scrollTop += dy;
        return;
      }
    }
    ui.menu = null;
    this.#setOrigin(viewport);
    const p = this.#local(e);
    const height = viewport.clientHeight;

    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
    let dx = e.deltaX * unit, dy = e.deltaY * unit;

    // Pinch arrives as ctrl+wheel and always zooms. The plain wheel does what the setting says
    // (default: pan on macOS for trackpads, zoom elsewhere like PureRef); shift+wheel always pans.
    if (e.ctrlKey || (settings.wheel === "zoom" && !e.shiftKey)) {
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
      if (smoothCamera()) camera.zoomSmooth(p.x, p.y, factor);
      else camera.zoomAt(p.x, p.y, factor);
    } else {
      if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
      camera.panBy(-dx, -dy);
    }
    this.#markCameraMoving();
  }

  /** Safari/WKWebView trackpad pinch. */
  gesture(e: Event & { scale?: number; clientX?: number; clientY?: number }, viewport: HTMLElement) {
    e.preventDefault();
    if (e.type === "gesturestart") {
      this.#pinchScale = 1;
      this.#setOrigin(viewport);
      return;
    }
    if (e.type !== "gesturechange" || !e.scale) return;
    const p = this.#local({ clientX: e.clientX ?? 0, clientY: e.clientY ?? 0 });
    camera.zoomAt(p.x, p.y, e.scale / this.#pinchScale);
    this.#pinchScale = e.scale;
    this.#markCameraMoving();
  }
}
