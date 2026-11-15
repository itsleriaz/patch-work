<script lang="ts">
  import { actions, actionTip, available, runAction } from "../actions.svelte";
  import { tip } from "./tips.svelte";
  import { drawUi } from "../drawing/draw.svelte";
  import { mapUi } from "../map/map.svelte";

  /**
   * The left edge's rail: what can be added to the board, then undo and redo. It never changes
   * with the selection, so its buttons stay where the hand expects them; unavailable ones dim.
   */

  const sections = [
    ["addText", "addChecklist", "addCounter", "addTimer", "addTable", "addPalette", "addMap", "addPin", "draw", "newFromTemplate"],
    ["undo", "redo"],
  ];

  /**
   * Draw mode and map editing have their own tools: adding things waits until they end (the pen
   * stays on as a way out of draw mode). Undo and redo keep working, for the last stroke or room.
   */
  const moded = $derived(drawUi.active || !!mapUi.editing);
  const enabled = (id: string) => available(id) && (!moded || id === "undo" || id === "redo" || (id === "draw" && drawUi.active));
</script>

<!-- Pressing a button doesn't take the focus: a text card being edited keeps its caret (and edit). -->
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_interactive_supports_focus -->
<div
  class="rail"
  role="toolbar"
  aria-label="Add to the board"
  aria-orientation="vertical"
  data-tip-side="right"
  onmousedown={(e) => (e.target as HTMLElement).closest("button") && e.preventDefault()}
>
  {#each sections as ids, i (i)}
    {#if i > 0}<div class="sep"></div>{/if}
    {#each ids as id (id)}
      {@const action = actions[id]}
      <button class:active={action.active?.()} disabled={!enabled(id)} {@attach tip(actionTip(id))} aria-label={action.label} onclick={() => runAction(id)}>
        {#if action.icon}<action.icon size={17} strokeWidth={1.8} />{/if}
      </button>
    {/each}
  {/each}
</div>

<style>
  .rail {
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 4px;
    border-radius: calc(12px * var(--round));
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    backdrop-filter: blur(12px);
    box-shadow: 0 6px 24px var(--panel-shadow);
    user-select: none;
    /* Short windows: it scrolls rather than running into the navigator. */
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .sep {
    flex: none;
    width: 20px;
    height: 1px;
    background: var(--panel-border);
    margin: 3px 0;
  }
  button {
    all: unset;
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: calc(8px * var(--round));
    color: var(--text);
    cursor: pointer;
    transition:
      background 100ms,
      scale 100ms;
  }
  button:hover:not(:disabled) {
    background: var(--panel-hover);
  }
  button:active:not(:disabled) {
    scale: 0.9;
  }
  button:disabled {
    opacity: 0.3;
    cursor: default;
  }
  button.active {
    background: var(--accent-wash);
    color: var(--accent);
  }
</style>
