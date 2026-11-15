import type { CameraState, Rect } from "../doc/types";

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 32;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** How fast a thrown pan slows down: its speed falls by 1/e every PAN_DECAY ms. */
const PAN_DECAY = 170;
/** Below this speed (screen px per ms) a glide stops. */
const PAN_STOP = 0.015;
/** Fastest throw, px per ms. */
const PAN_MAX = 6;
/** How quickly smooth zoom catches up with the wheel: the gap shrinks by 1/e every ZOOM_EASE ms. */
const ZOOM_EASE = 55;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Screen = world * zoom + (x, y). Screen coordinates are relative to the viewport element. */
export class Camera {
  x = $state(0);
  y = $state(0);
  zoom = $state(1);
  /** Viewport size in CSS px. */
  width = $state(0);
  height = $state(0);
  /** CSS px on the right covered by the side panel: framing and jumps center in the rest. */
  insetRight = $state(0);
  /** The middle of the uncovered part of the view, in screen px. */
  centerX = $derived((this.width - this.insetRight) / 2);

  #anim = 0;
  /** True while the camera glides or eases on its own (momentum, smooth zoom). */
  gliding = $state(false);
  /** Pan momentum: screen px per ms. */
  #vx = 0;
  #vy = 0;
  /** Smooth zoom: the zoom the wheel asked for, anchored at a screen point. */
  #goal: { zoom: number; sx: number; sy: number } | null = null;
  #glide = 0;
  /** A flyTo is running (it keeps `gliding` on). */
  #flying = false;
  #last = 0;

  #cancelAnim() {
    cancelAnimationFrame(this.#anim);
    if (this.#flying) this.#flying = this.gliding = false;
  }

  toWorld(sx: number, sy: number) {
    return { x: (sx - this.x) / this.zoom, y: (sy - this.y) / this.zoom };
  }

  /** The visible world rectangle. */
  viewRect = $derived<Rect>({
    x: -this.x / this.zoom,
    y: -this.y / this.zoom,
    w: this.width / this.zoom,
    h: this.height / this.zoom,
  });

  set(state: CameraState) {
    this.#cancelAnim();
    this.stop();
    this.x = state.x;
    this.y = state.y;
    this.zoom = state.zoom;
  }

  get state(): CameraState {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  panBy(dx: number, dy: number) {
    this.#cancelAnim();
    // Direct panning takes over from momentum; a smooth zoom in progress can carry on.
    this.#vx = this.#vy = 0;
    this.x += dx;
    this.y += dy;
  }

  /** Zooms keeping the screen point (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number) {
    this.#cancelAnim();
    this.stop();
    const zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const k = zoom / this.zoom;
    this.x = sx - (sx - this.x) * k;
    this.y = sy - (sy - this.y) * k;
    this.zoom = zoom;
  }

  /** Smoothly frames a world rectangle. */
  frame(rect: Rect, { padding = 64, maxZoom = 1, duration = 280 } = {}) {
    const zoom = clamp(
      Math.min((this.width - this.insetRight - padding * 2) / rect.w, (this.height - padding * 2) / rect.h, maxZoom),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    this.animateTo({
      zoom,
      x: this.centerX - (rect.x + rect.w / 2) * zoom,
      y: this.height / 2 - (rect.y + rect.h / 2) * zoom,
    }, duration);
  }

  /** Stops any glide, smooth zoom or animation where it is. */
  stop() {
    cancelAnimationFrame(this.#glide);
    this.#cancelAnim();
    this.#vx = this.#vy = 0;
    this.#goal = null;
    this.gliding = false;
  }

  /** Lets the camera keep moving at this velocity (screen px per ms), slowing with friction. */
  throw(vx: number, vy: number) {
    const speed = Math.hypot(vx, vy);
    if (speed < PAN_STOP * 4) return;
    const k = Math.min(1, PAN_MAX / speed);
    this.#vx = vx * k;
    this.#vy = vy * k;
    this.#run();
  }

  /** Like zoomAt, but eases there over a few frames; successive calls add up. */
  zoomSmooth(sx: number, sy: number, factor: number) {
    this.#cancelAnim();
    const from = this.#goal?.zoom ?? this.zoom;
    this.#goal = { zoom: clamp(from * factor, MIN_ZOOM, MAX_ZOOM), sx, sy };
    this.#run();
  }

  #run() {
    if (this.gliding) return;
    this.gliding = true;
    this.#last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(34, now - this.#last);
      this.#last = now;
      if (this.#vx || this.#vy) {
        this.x += this.#vx * dt;
        this.y += this.#vy * dt;
        const decay = Math.exp(-dt / PAN_DECAY);
        this.#vx *= decay;
        this.#vy *= decay;
        if (Math.hypot(this.#vx, this.#vy) < PAN_STOP) this.#vx = this.#vy = 0;
      }
      const goal = this.#goal;
      if (goal) {
        const logNow = Math.log(this.zoom), logGoal = Math.log(goal.zoom);
        const done = Math.abs(logGoal - logNow) < 0.002;
        const zoom = done ? goal.zoom : Math.exp(logNow + (logGoal - logNow) * (1 - Math.exp(-dt / ZOOM_EASE)));
        const k = zoom / this.zoom;
        this.x = goal.sx - (goal.sx - this.x) * k;
        this.y = goal.sy - (goal.sy - this.y) * k;
        this.zoom = zoom;
        if (done) this.#goal = null;
      }
      if (this.#vx || this.#vy || this.#goal) this.#glide = requestAnimationFrame(step);
      else this.gliding = false;
    };
    this.#glide = requestAnimationFrame(step);
  }

  animateTo(target: CameraState, duration: number) {
    this.#cancelAnim();
    this.stop();
    if (duration <= 0) return this.set(target);
    const from = this.state;
    // Interpolate zoom logarithmically so it feels uniform at any scale.
    const logFrom = Math.log(from.zoom), logTo = Math.log(target.zoom);
    const start = performance.now();
    const step = (now: number) => {
      // Clamped: a frame's timestamp can be a little before `start`.
      const t = easeOutCubic(Math.min(1, Math.max(0, (now - start) / duration)));
      const zoom = Math.exp(logFrom + (logTo - logFrom) * t);
      // Keep the path straight in world space: interpolate the world point at screen center.
      const cx = this.width / 2, cy = this.height / 2;
      const wFrom = { x: (cx - from.x) / from.zoom, y: (cy - from.y) / from.zoom };
      const wTo = { x: (cx - target.x) / target.zoom, y: (cy - target.y) / target.zoom };
      const wx = wFrom.x + (wTo.x - wFrom.x) * t, wy = wFrom.y + (wTo.y - wFrom.y) * t;
      this.zoom = zoom;
      this.x = cx - wx * zoom;
      this.y = cy - wy * zoom;
      if (t < 1) this.#anim = requestAnimationFrame(step);
    };
    this.#anim = requestAnimationFrame(step);
  }

  /**
   * Flies to a camera state like a map does: a far jump zooms out on the way, far enough to show
   * both ends at the midpoint, then in again. The view moves at an even speed on screen. `done`
   * runs on arrival (not when the flight is interrupted).
   */
  flyTo(target: CameraState, done?: () => void) {
    this.stop();
    const cx = this.width / 2, cy = this.height / 2;
    const from = this.state;
    const c0 = { x: (cx - from.x) / from.zoom, y: (cy - from.y) / from.zoom };
    const c1 = { x: (cx - target.x) / target.zoom, y: (cy - target.y) / target.zoom };
    const l0 = Math.log(from.zoom), l1 = Math.log(target.zoom);
    const dist = Math.hypot(c1.x - c0.x, c1.y - c0.y);
    // How far below the straight zoom path the middle dips: to the zoom showing both ends.
    const fit = Math.log(clamp((Math.min(this.width, this.height) * 0.8) / Math.max(dist, 1e-6), MIN_ZOOM, MAX_ZOOM));
    const hop = Math.max(0, (l0 + l1) / 2 - fit);
    const logZoom = (s: number) => l0 + (l1 - l0) * s - hop * Math.sin(Math.PI * s);
    // Progress along the way grows with 1/zoom, so the view crosses the screen at an even pace.
    const N = 64;
    const along = [0];
    for (let i = 1; i <= N; i++) along.push(along[i - 1] + Math.exp(-logZoom((i - 0.5) / N)));
    const progress = (s: number) => {
      const f = s * N, i = Math.min(N - 1, Math.floor(f));
      return (along[i] + (along[i + 1] - along[i]) * (f - i)) / along[N];
    };
    const duration = Math.min(1400, 420 + 220 * hop + 90 * Math.abs(l1 - l0));
    const start = performance.now();
    this.#flying = true;
    this.gliding = true;
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const s = easeInOutCubic(t), u = progress(s);
      const zoom = t < 1 ? Math.exp(logZoom(s)) : target.zoom;
      this.zoom = zoom;
      this.x = cx - (c0.x + (c1.x - c0.x) * u) * zoom;
      this.y = cy - (c0.y + (c1.y - c0.y) * u) * zoom;
      if (t < 1) this.#anim = requestAnimationFrame(step);
      else {
        this.#flying = false;
        this.gliding = false;
        done?.();
      }
    };
    this.#anim = requestAnimationFrame(step);
  }
}
