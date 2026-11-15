import { Editor, Extension, InputRule } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import Paragraph from "@tiptap/extension-paragraph";
import StarterKit from "@tiptap/starter-kit";
import { fmt, openLinkBar } from "./format.svelte";

/** An editor in a text card. */
export interface TextEditor {
  destroy(): void;
}

/**
 * The rich text editor (TipTap, on ProseMirror): what you edit looks exactly like the card, with
 * no Markdown markup at all; typing Markdown (`# `, `**bold**`, `- `, `[ ] `) formats as you go.
 * The card's Markdown is parsed in and written back out, which normalizes it (`*` bullets become
 * `-`, `__bold__` becomes `**bold**`, tables are padded), so it's written back only when the text
 * was actually changed. Loaded on demand, like the live-preview editor (`editor.ts`).
 */

/** Esc and Ctrl/⌘+Enter end the edit; Ctrl/⌘+K opens the link bar. */
const keys = (onDone: () => void) =>
  Extension.create({
    name: "pwKeys",
    addKeyboardShortcuts: () => ({ Escape: () => (onDone(), true), "Mod-Enter": () => (onDone(), true), "Mod-k": () => (openLinkBar(), true) }),
  });

/**
 * "[ ] " (or "[x] ") typed at the start of a list item makes it a task: "- " has already made the
 * bullet by then, and TipTap's own rule only starts a task list from a plain paragraph. The whole
 * list becomes a task list (as Markdown has it: a list is one or the other). At the start of a
 * task, it sets the task's box.
 */
const taskInList = Extension.create({
  name: "pwTaskInList",
  addInputRules: () => [
    new InputRule({
      find: /^\s*\[([ xX]?)\]\s$/,
      handler: ({ state, range, match, chain }) => {
        const $from = state.doc.resolve(range.from);
        const item = $from.node(-1)?.type.name;
        if ($from.parent.type.name !== "paragraph" || (item !== "listItem" && item !== "taskItem")) return null;
        const checked = /x/i.test(match[1] ?? "");
        if (item === "taskItem") chain().deleteRange(range).updateAttributes("taskItem", { checked }).run();
        else chain().deleteRange(range).toggleTaskList().updateAttributes("taskItem", { checked }).run();
      },
    }),
  ],
});

/**
 * An empty paragraph (an empty line) is always written "&nbsp;". TipTap writes a lone one as extra
 * blank lines, which it doesn't read back before a list (and Markdown collapses), so it would
 * vanish on the next edit and differ from the card; "&nbsp;" reads back as an empty paragraph here
 * and renders as an empty line in the card.
 */
const emptyParagraphs = Paragraph.extend({
  renderMarkdown(node, h, ctx) {
    if (!node?.content?.length) return "&nbsp;";
    return this.parent?.(node, h, ctx) ?? "";
  },
});

/**
 * Markdown as cards store it: line breaks written as plain newlines (the cards render a newline
 * as a break; TipTap writes "two spaces, newline"), no blank lines around the whole text.
 */
const tidy = (md: string) => md.replace(/ {2}\n/g, "\n").replace(/^\n+|\n+$/g, "");

export function createEditor(parent: HTMLElement, doc: string, opts: { onChange: (md: string) => void; onDone: () => void }): TextEditor {
  const editor = new Editor({
    element: parent,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true }, trailingNode: false, paragraph: false }),
      emptyParagraphs,
      TaskList,
      TaskItem.configure({ nested: true }),
      taskInList,
      TableKit,
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
      keys(opts.onDone),
    ],
    content: doc,
    contentType: "markdown",
    // The card's own typography (text/markdown.css).
    editorProps: { attributes: { class: "pw-md", spellcheck: "false" } },
    onUpdate: ({ editor }) => opts.onChange(tidy(editor.getMarkdown())),
    // The toolbar's formatting buttons follow the caret.
    onTransaction: () => fmt.tick++,
    // Typing a URL in the link bar takes the focus without ending the edit.
    onBlur: () => void (fmt.linking || opts.onDone()),
  });
  fmt.editor = editor;
  editor.commands.focus("end");
  return {
    destroy: () => {
      if (fmt.editor === editor) fmt.editor = null;
      fmt.linking = false;
      editor.destroy();
    },
  };
}
