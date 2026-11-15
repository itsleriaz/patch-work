<script lang="ts">
  import { commitEdit } from "../actions.svelte";
  import { doc, fresh, linkSelection, ui } from "../app.svelte";
  import { shownNode } from "../frame/frames.svelte";
  import type { CanvasLink } from "../doc/types";
  import { draftPath, linkPath } from "../links/geometry";
  import { linkData, linkSides } from "../links/palette";
  import { settings } from "../settings.svelte";
  import type { Interaction } from "./interaction.svelte";
  import LinkView from "./LinkView.svelte";

  let { links, ix }: { links: CanvasLink[]; ix: Interaction } = $props();

  // The link being dragged, in the shape it will get: one line per fixed end, snapping onto the
  // target node (and its pinned side) when over one.
  const drafts = $derived.by(() => {
    const d = ix.linkDraft;
    if (!d) return [];
    const target = d.target ? (shownNode(d.target) ?? null) : null;
    const shape = d.relink ? linkData(doc.links[d.relink]?.data).shape : settings.linkShape;
    return d.fixed.flatMap((f) => {
      const node = shownNode(f.node);
      if (!node) return [];
      if (!target) return [draftPath(node, d.to, shape, f.side)];
      return [f.isTo ? linkPath(target, node, shape, { from: d.side, to: f.side }) : linkPath(node, target, shape, { from: f.side, to: d.side })];
    });
  });

  // The label being edited sits where the label is drawn.
  const editing = $derived.by(() => {
    const id = ui.editingLink?.id;
    const link = id ? doc.links[id] : null;
    const a = link && shownNode(link.from), b = link && shownNode(link.to);
    return link && a && b ? { link, mid: linkPath(a, b, linkData(link.data).shape, linkSides(link.data)).mid } : null;
  });

  function focus(el: HTMLInputElement) {
    el.focus({ preventScroll: true });
    el.select();
  }

  function onInput(e: Event) {
    const link = editing?.link;
    if (link) link.data = { ...linkData(link.data), label: (e.target as HTMLInputElement).value };
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      commitEdit();
    }
  }
</script>

<svg class="links" aria-hidden="true">
  {#each links as link (link.id)}
    <LinkView
      {link}
      selected={linkSelection.has(link.id)}
      fresh={fresh.has(link.id)}
      editing={ui.editingLink?.id === link.id}
      relinking={ix.linkDraft?.relink === link.id}
    />
  {/each}
  {#each drafts as draft, i (i)}
    <path class="draft" class:snapped={!!ix.linkDraft?.target} d={draft.d} />
  {/each}
</svg>

{#if editing}
  <input
    class="label-editor"
    data-editor
    value={linkData(editing.link.data).label}
    placeholder="Label"
    spellcheck="false"
    style:left="{editing.mid.x}px"
    style:top="{editing.mid.y}px"
    oninput={onInput}
    onkeydown={onKeydown}
    onblur={commitEdit}
    {@attach focus}
  />
{/if}

<style>
  .links {
    position: absolute;
    left: 0;
    top: 0;
    width: 1px;
    height: 1px;
    overflow: visible;
    pointer-events: none;
    /* Under every node, including ones sent to the back. */
    z-index: -2147483646;
  }
  .draft {
    fill: none;
    stroke: var(--accent);
    stroke-width: calc(2px * var(--inv-zoom));
    stroke-dasharray: calc(6px * var(--inv-zoom)) calc(5px * var(--inv-zoom));
    stroke-linecap: round;
    opacity: 0.8;
  }
  .draft.snapped {
    stroke-dasharray: none;
    opacity: 1;
  }
  .label-editor {
    position: absolute;
    z-index: 2147483647;
    translate: -50% -50%;
    width: 12em;
    font: 500 15px/1.3 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    text-align: center;
    color: var(--text);
    background: var(--panel-solid);
    border: calc(1.5px * var(--inv-zoom)) solid var(--accent);
    border-radius: calc(6px * var(--round));
    padding: 3px 6px;
    outline: none;
    user-select: text;
    -webkit-user-select: text;
  }
</style>
