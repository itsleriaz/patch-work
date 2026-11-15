import MarkdownIt from "markdown-it";

// `html: false` escapes raw HTML in the source, so the output is safe to inject.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: true });

/**
 * Task list items ("- [ ] milk", "- [x] eggs") get a box, as the editor shows them (done ones are
 * dimmed). Read from the raw source, so an escaped "\[ \]" stays text, as it does in the editor.
 * A box carries its source line (`data-line`), so a click on a rendered card ticks it (`toggleTaskAt`);
 * `data-editor` keeps the canvas from treating that click as a select or a drag.
 */
md.core.ruler.after("inline", "pw-tasks", (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "list_item_open") continue;
    // The item's first paragraph (hidden in tight lists).
    const inline = tokens[i + 2]?.type === "inline" ? tokens[i + 2] : null;
    const m = inline && /^\[([ xX])\]\s/.exec(inline.content);
    if (!inline || !m || !inline.children?.length) continue;
    const first = inline.children[0];
    if (first.type !== "text" || !/^\[[ xX]\]\s/.test(first.content)) continue;
    const done = m[1] !== " ";
    first.content = first.content.slice(4);
    // The box, then the text in a span (a done task dims its text, not its box).
    const html = (content: string) => Object.assign(new state.Token("html_inline", "", 0), { content });
    const line = tokens[i].map?.[0];
    const box = line === undefined ? `<input type="checkbox" disabled${done ? " checked" : ""}>` : `<input type="checkbox" tabindex="-1" data-editor data-line="${line}"${done ? " checked" : ""}>`;
    inline.children.unshift(html(box), html('<span class="task-text">'));
    inline.children.push(html("</span>"));
    tokens[i].attrJoin("class", done ? "task done" : "task");
  }
});

/**
 * The source with the task on `line` ticked or unticked (its "[ ]" / "[x]" after the list marker,
 * also inside quotes), or null when that line holds no task.
 */
export function toggleTaskAt(source: string, line: number): { md: string; done: boolean } | null {
  const lines = source.split("\n");
  const m = /^([\s>]*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(lines[line] ?? "");
  if (!m) return null;
  const done = m[2] === " ";
  lines[line] = m[1] + (done ? "[x]" : "[ ]") + lines[line].slice(m[0].length);
  return { md: lines.join("\n"), done };
}

const cache = new Map<string, string>();

export function renderMarkdown(source: string): string {
  let html = cache.get(source);
  if (html === undefined) {
    html = md.render(source);
    if (cache.size > 500) cache.clear();
    cache.set(source, html);
  }
  return html;
}
