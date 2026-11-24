<script lang="ts">
  import { fitSize } from "./flow";
  import { commitEdit } from "../actions.svelte";
  import { backend } from "../backend";
  import { play } from "../juice/sound";
  import type { CanvasNode } from "../doc/types";
  import { isMac } from "../platform";
  import { renderMarkdown, toggleTaskAt } from "../text/markdown";
  import { history } from "../app.svelte";
  import { editorModule } from "../text/load-editor";
  import { untrack } from "svelte";
  import "../text/markdown.css";
  import { TEXT_COLORS, textData } from "../text/palette";

  let { node, editing }: { node: CanvasNode; editing: boolean } = $props();

  const data = $derived(textData(node.data));
  const colors = $derived(TEXT_COLORS[data.color] ?? TEXT_COLORS.none);

  let box: HTMLDivElement;

  // Height follows the content. Layout size is unaffected by the camera's scale.
  $effect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (data.fixed) return;
      const h = entry.borderBoxSize[0]?.blockSize ?? box.offsetHeight;
      if (h > 0 && Math.abs(h - node.h) > 0.5) fitSize(node, node.w, h);
    });
    observer.observe(box);
    return () => observer.disconnect();
  });

  function focusAtEnd(el: HTMLTextAreaElement) {
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }

  function setText(md: string) {
    node.data = { ...textData(node.data), md };
    play("type", { volume: 0.5, throttle: 25, jitter: 0.08 });
  }
  const onInput = (e: Event) => setText((e.target as HTMLTextAreaElement).value);

  // The rich editor (TipTap), once it has loaded (read when an edit starts); until then, the textarea.
  function mountEditor(el: HTMLElement) {
    const editor = editorModule();
    if (!editor) return;
    const ed = untrack(() => editor.createEditor(el, data.md, { onChange: setText, onDone: commitEdit }));
    return () => ed.destroy();
  }

  function onKeydown(e: KeyboardEvent) {
    const el = e.target as HTMLTextAreaElement;
    if (e.key === "Escape" || (e.key === "Enter" && (isMac ? e.metaKey : e.ctrlKey))) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Tab") {
      e.preventDefault();
      el.setRangeText("  ", el.selectionStart, el.selectionEnd, "end");
      onInput(e);
    }
  }

  // A task box ticks right on the card, one undo step each (the box itself waits for the re-render).
  // Links open with Ctrl/⌘+click; a plain click selects the node like anywhere else.
  function onClick(e: MouseEvent) {
    const box = (e.target as HTMLElement).closest<HTMLInputElement>("input[data-line]");
    if (box) {
      e.preventDefault();
      const next = toggleTaskAt(data.md, Number(box.dataset.line));
      if (!next) return;
      history.run(next.done ? "Check task" : "Uncheck task", [{ type: "updateNodes", changes: [{ id: node.id, props: { data: { ...textData($state.snapshot(node.data)), md: next.md } } }] }]);
      play(next.done ? "toggleOn" : "toggleOff", { volume: 0.55, pitch: next.done ? 1.1 : 0.95 });
      return;
    }
    const link = (e.target as HTMLElement).closest("a");
    if (!link) return;
    e.preventDefault();
    if (isMac ? e.metaKey : e.ctrlKey) backend.openUrl(link.href);
  }
</script>

<div
  class="text"
  class:card={data.color !== "none"}
  class:fixed={data.fixed}
  data-scroll={data.fixed ? "" : null}
  bind:this={box}
  style:font-size="{data.fontSize}px"
  style:text-align={data.align}
  style:color={colors.fg}
  style:background={colors.bg}
>
  {#if editing && editorModule()}
    <div class="live" data-editor {@attach mountEditor}></div>
  {:else if editing}
    <div class="grow" data-replicated={data.md + " "}>
      <textarea
        data-editor
        value={data.md}
        placeholder="Type Markdown…"
        spellcheck="false"
        oninput={onInput}
        onkeydown={onKeydown}
        onblur={commitEdit}
        {@attach focusAtEnd}
      ></textarea>
    </div>
  {:else}
    <!-- markdown-it runs with html disabled, so raw HTML in the source is escaped. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="md pw-md" onclick={onClick}>{@html renderMarkdown(data.md)}</div>
  {/if}
</div>

<style>
  .text {
    width: 100%;
    padding: 0.5em 0.7em;
    box-sizing: border-box;
    line-height: 1.45;
    overflow-wrap: anywhere;
    border-radius: calc(0.45em * var(--round));
  }
  /* A fixed-height card: the node's box decides, and what doesn't fit scrolls (wheel over it). */
  .fixed {
    height: 100%;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .fixed::-webkit-scrollbar {
    display: none;
  }
  .card {
    box-shadow: 0 calc(3px * var(--shadow-zoom)) calc(14px * var(--shadow-zoom)) var(--node-shadow);
  }

  /* Auto-growing textarea: a hidden copy of the text sizes the shared grid cell. */
  .grow {
    display: grid;
  }
  .grow::after {
    content: attr(data-replicated);
    white-space: pre-wrap;
    visibility: hidden;
  }
  .grow > textarea,
  .grow::after {
    grid-area: 1 / 1 / 2 / 2;
    font: inherit;
    line-height: inherit;
    letter-spacing: inherit;
    padding: 0;
    margin: 0;
    border: 0;
    overflow-wrap: anywhere;
  }
  /* In the card's own font and size, so starting to edit doesn't change how the card looks. */
  textarea {
    resize: none;
    overflow: hidden;
    background: transparent;
    color: inherit;
    outline: none;
    text-align: inherit;
    caret-color: var(--accent);
    user-select: text;
    -webkit-user-select: text;
  }
  textarea::placeholder {
    color: inherit;
    opacity: 0.4;
  }

</style>
