import type { TextEditor } from "./rich-editor";

/**
 * Text cards' editor (TipTap, about 150 KB gzipped) loads in its own chunk: \`preloadEditor\`
 * fetches it once the app is idle; until it's there, a card edits in a plain textarea.
 */
type EditorModule = { createEditor(parent: HTMLElement, doc: string, opts: { onChange: (md: string) => void; onDone: () => void }): TextEditor };

let loaded: EditorModule | null = null;
let pending: Promise<EditorModule> | null = null;

export function preloadEditor(): Promise<EditorModule> {
  pending ??= import("./rich-editor").then((m) => (loaded = m));
  return pending;
}

/** The editor, if it has loaded (starting its load if not). */
export function editorModule(): EditorModule | null {
  if (!loaded) void preloadEditor();
  return loaded;
}
