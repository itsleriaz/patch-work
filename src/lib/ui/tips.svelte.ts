import type { Attachment } from "svelte/attachments";

/**
 * The app's tooltips: one floating card (Tooltip.svelte) shared by every element that opts in
 * with `{@attach tip(...)}` instead of a native `title`.
 *
 * - It appears after DELAY ms of hovering; while one is showing (or was a moment ago), the next
 *   element shows its tip at once, so a row of buttons can be read by sweeping across it.
 * - It hides on any press (and stays away from that element until the pointer leaves it), any
 *   key, wheel or scroll, and, for elements on the canvas, when the camera moves.
 * - Keyboard focus (`:focus-visible`) shows it too.
 */

export interface TipContent {
  text: string;
  /** A shortcut, already formatted ("Ctrl+Z", "⇧⌘Z", "1–9"), shown as a key chip. */
  keys?: string | null;
  /** A quieter line under the text. */
  detail?: string | null;
}

export type TipSource = string | TipContent | null | undefined | false;

const DELAY = 450;
/** After a tip hides, the next one within this long shows without the delay. */
const GRACE = 300;

class TipState {
  /** The tip on screen: what it says, and the screen rectangle of the element it belongs to. */
  current = $state.raw<{ content: TipContent; rect: DOMRect; inCanvas: boolean; right: boolean } | null>(null);
}
export const tipState = new TipState();

const contents = new WeakMap<Element, TipContent>();
/** The element whose tip is showing, or waiting for the delay. */
let anchor: Element | null = null;
let timer = 0;
let lastHidden = -Infinity;
/** Pressed: no tip for it until the pointer leaves it. */
let blocked: Element | null = null;

function show(el: Element) {
  const content = contents.get(el);
  if (!content || !el.isConnected) return;
  anchor = el;
  // A vertical strip of buttons (`data-tip-side="right"`, the create rail) has its tips beside it.
  tipState.current = { content, rect: el.getBoundingClientRect(), inCanvas: !!el.closest(".viewport"), right: !!el.closest("[data-tip-side=right]") };
}

export function hideTip() {
  clearTimeout(timer);
  if (tipState.current) lastHidden = performance.now();
  tipState.current = null;
  anchor = null;
}

function enter(el: Element) {
  if (blocked === el) return;
  clearTimeout(timer);
  anchor = el;
  if (tipState.current || performance.now() - lastHidden < GRACE) show(el);
  else timer = window.setTimeout(() => anchor === el && show(el), DELAY);
}

function leave(el: Element) {
  if (blocked === el) blocked = null;
  if (anchor === el) hideTip();
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  const dismiss = () => (anchor || tipState.current) && hideTip();
  window.addEventListener("pointerdown", () => {
    blocked = anchor;
    dismiss();
    // A press isn't sweeping across buttons: whatever ends up under the pointer waits again.
    lastHidden = -Infinity;
  }, true);
  window.addEventListener("keydown", dismiss, true);
  window.addEventListener("wheel", dismiss, { capture: true, passive: true });
  window.addEventListener("scroll", dismiss, true);
  window.addEventListener("blur", dismiss);
}

const normalize = (s: TipSource): TipContent | null => (!s ? null : typeof s === "string" ? { text: s } : s.text ? s : null);

/** Gives an element a tooltip. Elements with no text or label of their own get it as their aria-label. */
export function tip(source: TipSource): Attachment<HTMLElement | SVGElement> {
  return (el) => {
    const content = normalize(source);
    if (!content) return;
    listen();
    contents.set(el, content);
    if (!el.hasAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", content.text);
    // The tip on screen follows a change of what it says (e.g. a toggle's label).
    if (anchor === el && tipState.current) tipState.current = { ...tipState.current, content };

    const onEnter = (e: PointerEvent) => e.pointerType !== "touch" && enter(el);
    const onLeave = () => leave(el);
    const onFocus = () => el.matches(":focus-visible") && show(el);
    const onBlur = () => anchor === el && hideTip();
    el.addEventListener("pointerenter", onEnter as EventListener);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("focus", onFocus);
    el.addEventListener("blur", onBlur);
    return () => {
      el.removeEventListener("pointerenter", onEnter as EventListener);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("focus", onFocus);
      el.removeEventListener("blur", onBlur);
      contents.delete(el);
      // Re-run with new content (it registers again right away), or gone for good.
      queueMicrotask(() => {
        if (anchor === el && (!contents.has(el) || !el.isConnected)) hideTip();
      });
    };
  };
}
