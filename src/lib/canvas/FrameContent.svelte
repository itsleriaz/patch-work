<script lang="ts">
  import { ChevronDown, ChevronRight, Stamp } from "@lucide/svelte";
  import type { CanvasNode } from "../doc/types";
  import { frameUi, membersOf, setFrame, toggleCollapse } from "../frame/frames.svelte";
  import { COLLAPSED_H, FRAME_COLORS, frameData, PREVIEW_PAD } from "../frame/model";
  import { selectOnly } from "../app.svelte";
  import { settings } from "../settings.svelte";
  import FramePreview from "./FramePreview.svelte";
  import { tip } from "../ui/tips.svelte";

  let { node }: { node: CanvasNode } = $props();

  const d = $derived(frameData(node.data));
  const members = $derived(membersOf(node));
  const count = $derived(members.length);
  // The card made room for it (`collapsedSize`): taller than the title strip.
  const preview = $derived(d.collapsed && settings.framePreviews && count > 0 && node.h > COLLAPSED_H + 1);
  const color = $derived(FRAME_COLORS[d.color]?.color ?? FRAME_COLORS.default.color);
  const editing = $derived(frameUi.editing === node.id);
  const target = $derived(frameUi.dropTarget === node.id);
  const leaving = $derived(frameUi.leaving === node.id);

  function focus(el: HTMLInputElement) {
    el.focus({ preventScroll: true });
    el.select();
  }

  let cancelled = false;
  function commit(value: string) {
    if (frameUi.editing !== node.id) return;
    frameUi.editing = null;
    if (cancelled) return void (cancelled = false);
    setFrame(node, "Rename frame", { title: value.trim() });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit((e.target as HTMLInputElement).value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelled = true;
      (e.target as HTMLInputElement).blur();
    }
  }

  function toggle(e: MouseEvent) {
    e.stopPropagation();
    selectOnly([node.id]);
    toggleCollapse();
  }

  const stop = (e: Event) => e.stopPropagation();
</script>

<!-- The body lets clicks through (nodes inside stay clickable, marquees start inside); only the
     title bar belongs to the frame. -->
<div class="frame" class:collapsed={d.collapsed} class:previewed={preview} class:target class:leaving class:gulp={frameUi.gulp === node.id} style:--fc={color} style:--title-h="{COLLAPSED_H}px" style:--pad="{PREVIEW_PAD}px">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="bar"
    ondblclick={(e) => {
      e.stopPropagation();
      frameUi.editing = node.id;
    }}
  >
    <button class="chev" aria-label={d.collapsed ? "Expand" : "Collapse"} onpointerdown={stop} ondblclick={stop} onclick={toggle}>
      {#if d.collapsed}<ChevronRight />{:else}<ChevronDown />{/if}
    </button>
    {#if editing}
      <input
        class="title-edit"
        data-editor
        value={d.title}
        placeholder="Frame"
        spellcheck="false"
        onpointerdown={stop}
        onkeydown={onKeydown}
        onblur={(e) => commit((e.target as HTMLInputElement).value)}
        {@attach focus}
      />
    {:else}
      <span class="title" class:placeholder={!d.title}>{d.title || "Frame"}</span>
    {/if}
    {#if d.template}<span class="template" {@attach tip("Template: New from template makes copies of it")}><Stamp size={13} strokeWidth={2} />Template</span>{/if}
    <span class="count">{count} item{count === 1 ? "" : "s"}</span>
  </div>
  {#if preview}
    <!-- Part of the card: dragging it moves the frame, double-clicking opens it. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="preview" ondblclick={toggle}><FramePreview {members} /></div>
  {/if}
</div>

<style>
  .frame {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    border-radius: calc(14px * var(--round));
    border: calc(1.5px * var(--inv-zoom)) solid color-mix(in srgb, var(--fc) 45%, transparent);
    background: color-mix(in srgb, var(--fc) 7%, transparent);
    pointer-events: none;
    transition:
      border-color 150ms,
      background 150ms;
  }
  .frame.target {
    border: calc(2.5px * var(--inv-zoom)) dashed var(--accent);
    background: color-mix(in srgb, var(--accent) 9%, transparent);
  }
  /* A member is being dragged out: the frame lets go of it. */
  .frame.leaving {
    border: calc(2px * var(--inv-zoom)) dashed color-mix(in srgb, var(--fc) 60%, transparent);
    background: color-mix(in srgb, var(--fc) 3%, transparent);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 14px 0 8px;
    font-size: 16px;
    color: color-mix(in srgb, var(--fc) 75%, var(--text));
    pointer-events: auto;
    cursor: grab;
    user-select: none;
  }
  /* A collapsed frame that just took nodes in. */
  .collapsed.gulp {
    animation: gulp 420ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes gulp {
    30% {
      scale: 1.07 0.94;
    }
    60% {
      scale: 0.98 1.03;
    }
  }
  :global(:root[data-calm]) .collapsed.gulp {
    animation: none;
  }
  .collapsed {
    background: color-mix(in srgb, var(--fc) 14%, var(--panel-solid));
    border-color: color-mix(in srgb, var(--fc) 55%, transparent);
    box-shadow: 0 calc(3px * var(--inv-zoom)) calc(14px * var(--inv-zoom)) var(--node-shadow);
  }
  .collapsed .bar {
    height: 100%;
  }
  .collapsed.previewed .bar {
    height: var(--title-h);
  }
  .preview {
    position: absolute;
    left: var(--pad);
    right: var(--pad);
    top: var(--title-h);
    bottom: var(--pad);
    pointer-events: auto;
    cursor: grab;
  }
  .chev {
    /* Buttons don't inherit font-size. */
    font: inherit;
    flex: none;
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    border-radius: calc(7px * var(--round));
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .chev:hover {
    background: color-mix(in srgb, var(--fc) 18%, transparent);
  }
  .chev :global(svg) {
    width: 18px;
    height: 18px;
  }
  .title {
    flex: 1;
    min-width: 0;
    font-weight: 650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .placeholder {
    opacity: 0.55;
  }
  .title-edit {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-weight: 650;
    color: inherit;
    background: var(--panel-solid);
    border: none;
    border-radius: calc(6px * var(--round));
    outline: calc(1.5px * var(--inv-zoom)) solid var(--accent);
    padding: 2px 6px;
    user-select: text;
    -webkit-user-select: text;
  }
  /* A template's tag: paint-only, like the rest of the title bar (HANDOFF §8). */
  .template {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px 1px 6px;
    border-radius: 999px;
    border: 1px solid currentColor;
    font-size: 11.5px;
    font-weight: 600;
    opacity: 0.85;
  }
  .count {
    flex: none;
    font-size: 13px;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }
</style>
