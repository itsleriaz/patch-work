import type { Editor } from "@tiptap/core";

/**
 * Formatting the text card being edited (the rich editor, rich-editor.ts): the editor registers
 * itself here while it's open, so the toolbar's formatting actions can act on it and show what's
 * under the caret. Only TipTap's types are imported: the editor stays in its own chunk.
 */
class Format {
  /** The open rich editor, if a text card is being edited. */
  editor = $state.raw<Editor | null>(null);
  /** Bumped on every change in the editor, so active states refresh. */
  tick = $state(0);
  /** The link bar is open (typing a URL): the editor keeps its edit while it has the focus. */
  linking = $state(false);
}
export const fmt = new Format();

export const formatting = () => fmt.editor !== null;

/** Whether the caret (or selection) is in this mark or node. */
export function isActive(name: string, attrs?: Record<string, unknown>): boolean {
  void fmt.tick;
  return !!fmt.editor?.isActive(name, attrs);
}

type Chain = ReturnType<Editor["chain"]>;
/** Runs a command on the open editor, keeping its focus. */
export function format(fn: (chain: Chain) => Chain) {
  if (fmt.editor) fn(fmt.editor.chain().focus()).run();
}

export const toggleHeading = (level: 1 | 2 | 3) => format((c) => c.toggleHeading({ level }));

/** Opens the link bar for the selection (or the link under the caret). */
export function openLinkBar() {
  if (fmt.editor) fmt.linking = true;
}

/** The link under the caret (to edit in the link bar). */
export const currentLink = () => (fmt.editor?.getAttributes("link").href as string | undefined) ?? "";

/** Sets the selection's link (extending over a link the caret is in); an empty URL removes it. */
export function applyLink(url: string) {
  const href = url.trim();
  fmt.linking = false;
  if (!href) return format((c) => c.extendMarkRange("link").unsetLink());
  const full = /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/") ? href : `https://${href}`;
  const editor = fmt.editor;
  if (!editor) return;
  // Nothing selected and no link here: insert the URL itself as the link's text.
  if (editor.state.selection.empty && !editor.isActive("link")) {
    format((c) => c.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href: full } }] }));
  } else format((c) => c.extendMarkRange("link").setLink({ href: full }));
}

export function closeLinkBar() {
  fmt.linking = false;
  fmt.editor?.commands.focus();
}
